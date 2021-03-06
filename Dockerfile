FROM mhart/alpine-node:6

WORKDIR /src
ADD . .

RUN apk add --no-cache git

RUN npm install --production

EXPOSE 4278
CMD ["node", "index.js"]
