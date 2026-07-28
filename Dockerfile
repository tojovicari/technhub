FROM node:22-alpine

WORKDIR /app

# `tsx` roda o TypeScript direto em produção (sem passo de build/dist) —
# reflete como o projeto já roda em dev (`tsx watch`); por isso `npm ci`
# inclui devDependencies (typescript é usado só por `npm run build`, que é
# type-check no CI, não gera artefato consumido aqui).
COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
