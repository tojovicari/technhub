/**
 * Backfill histórico em janelas de tempo adaptativas — compartilhado entre
 * GitHub e Jira (os dois providers com busca ampla sujeita a um teto de
 * resultados por query: 1000 na Search API do GitHub, mesmo teto
 * auto-imposto aqui pro Jira por consistência).
 *
 * Motivação (ver plano desta rodada): uma janela "grande demais" nunca cabe
 * numa query só quando o volume de atividade é alto — verificado ao vivo,
 * uma janela de 30 dias já ultrapassa 1000 itens em orgs/sites ativos. O
 * dimensionamento adaptativo ("encolhe até caber") resolve isso sem
 * precisar de paralelismo nem de conhecimento prévio do volume.
 *
 * Só entra em ação enquanto `SyncContext.since` não existe (backfill ainda
 * não completou) — uma vez completo, o provider volta ao modo simples de
 * sempre (uma query, sem janela), já que incrementos do dia a dia nunca são
 * grandes o bastante pra precisar disso.
 */

export const DEFAULT_BACKFILL_DEPTH_DAYS = 365;
export const DEFAULT_WINDOW_SIZE_DAYS = 30;
export const MIN_WINDOW_SIZE_DAYS = 1;
export const BACKFILL_RESULT_CAP = 1000;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface BackfillCursorState {
  readonly windowEnd: Date;
  readonly windowSizeDays: number;
  readonly page: number;
  /**
   * Token opaco de continuação dentro da janela, pra providers com
   * paginação por cursor (Jira: `nextPageToken`) em vez de página numerada
   * (GitHub: `page`/`per_page`). `null`/ausente pros providers que não
   * precisam (GitHub usa só `page`).
   */
  readonly pageToken: string | null;
}

/**
 * `null` quando não há cursor, ou quando o cursor não bate no formato
 * esperado (`"{windowEndISO}|{windowSizeDays}|{page}[|{pageToken}]"`) —
 * cobre tanto a primeira sync de uma integração nova quanto uma integração
 * com cursor no formato antigo (de antes desta mudança). Em ambos os casos,
 * o chamador trata como "começa uma janela nova, a mais recente" —
 * autocorretivo, sem precisar de migration nem tratamento especial.
 *
 * Separador `|`, não `:` — `windowEndISO` (`toISOString()`) já contém ':'
 * (ex: `2026-07-28T17:35:02.165Z`), o que quebrava o parse a cada
 * round-trip (bug real, visto ao vivo: o cursor nunca avançava, cada sync
 * reiniciava do zero porque `split(':')` fatiava o próprio timestamp).
 */
export function parseBackfillCursor(cursor: string | null | undefined): BackfillCursorState | null {
  if (!cursor) {
    return null;
  }

  const parts = cursor.split('|');
  if (parts.length < 3) {
    return null;
  }

  const [windowEndRaw, windowSizeDaysRaw, pageRaw, ...pageTokenParts] = parts;
  const windowEnd = new Date(windowEndRaw);
  const windowSizeDays = Number(windowSizeDaysRaw);
  const page = Number(pageRaw);
  // Reunido de volta (em vez de só `pageTokenParts[0]`) porque o token opaco
  // do provider pode, em tese, conter '|' — não custa ser robusto aqui.
  const pageToken = pageTokenParts.length > 0 ? pageTokenParts.join('|') : null;

  if (
    Number.isNaN(windowEnd.getTime()) ||
    !Number.isFinite(windowSizeDays) ||
    windowSizeDays <= 0 ||
    !Number.isInteger(page) ||
    page < 1
  ) {
    return null;
  }

  return { windowEnd, windowSizeDays, page, pageToken };
}

export function serializeBackfillCursor(state: BackfillCursorState): string {
  const base = `${state.windowEnd.toISOString()}|${state.windowSizeDays}|${state.page}`;
  return state.pageToken ? `${base}|${state.pageToken}` : base;
}

/** Início do backfill (piso de `depthDays` atrás de agora) — fixo, não se move com a janela. */
export function computeBackfillFloor(depthDays: number = DEFAULT_BACKFILL_DEPTH_DAYS): Date {
  return new Date(Date.now() - depthDays * ONE_DAY_MS);
}

/** Início da janela atual, já limitado ao piso de backfill (nunca ultrapassa `floor`). */
export function computeWindowStart(windowEnd: Date, windowSizeDays: number, floor: Date): Date {
  const rawStart = new Date(windowEnd.getTime() - windowSizeDays * ONE_DAY_MS);
  return rawStart.getTime() < floor.getTime() ? floor : rawStart;
}

/** A janela atual já alcançou (ou passou) o piso de backfill — não há janela seguinte, backfill completo. */
export function isAtBackfillFloor(windowStart: Date, floor: Date): boolean {
  return windowStart.getTime() <= floor.getTime();
}

/**
 * Encolhe `startingGuessDays` pela metade até `countFn` devolver
 * `<= BACKFILL_RESULT_CAP` ou até `MIN_WINDOW_SIZE_DAYS`. `countFn` é a
 * chamada de contagem específica do provider (sem buscar os itens de
 * verdade — GitHub: `total_count` da busca com `per_page=1`; Jira:
 * `POST /rest/api/3/search/approximate-count`).
 *
 * Encontrar o tamanho certo custa 1+ chamadas de contagem por janela nova
 * (não por página) — o tamanho encontrado numa janela vira o palpite
 * inicial da seguinte, então na prática a maioria das janelas adjacentes
 * não precisa encolher de novo do zero.
 */
export async function resolveSafeWindowSizeDays(
  windowEnd: Date,
  startingGuessDays: number,
  floor: Date,
  countFn: (windowStart: Date, windowEnd: Date) => Promise<number>,
): Promise<number> {
  let candidateDays = startingGuessDays;

  while (candidateDays > MIN_WINDOW_SIZE_DAYS) {
    const windowStart = computeWindowStart(windowEnd, candidateDays, floor);
    const count = await countFn(windowStart, windowEnd);

    if (count <= BACKFILL_RESULT_CAP) {
      return candidateDays;
    }

    candidateDays = Math.max(candidateDays / 2, MIN_WINDOW_SIZE_DAYS);
  }

  return MIN_WINDOW_SIZE_DAYS;
}
