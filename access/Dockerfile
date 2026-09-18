FROM node:22.23.2-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY src ./src
USER node
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node","src/server.mjs"]
