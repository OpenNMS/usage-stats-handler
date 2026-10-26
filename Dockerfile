FROM docker.io/library/node:26-alpine

RUN mkdir /app
WORKDIR /app

COPY package.json package-lock.json /app/

RUN npm ci

COPY . /app

EXPOSE 3542

CMD ["npm", "start"]
