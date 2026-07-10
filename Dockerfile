FROM node:22

ENV NODE_PATH=/node_modules

RUN npm install -g pnpm@latest-10
