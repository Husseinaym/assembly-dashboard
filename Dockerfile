FROM node:24-slim
WORKDIR /home/node/app
COPY website/package.json website/package-lock.json website/
RUN cd website && npm ci --omit=dev
COPY website/ website/
RUN mkdir -p /home/node/data && chown -R node:node /home/node
USER node
ENV PDA_DB=/home/node/data/production.db PDA_UPLOADS=/home/node/data/Uploads PDA_BACKUPS=/home/node/data/Backups PORT=7860
EXPOSE 7860
CMD ["node", "website/server/start.js"]
