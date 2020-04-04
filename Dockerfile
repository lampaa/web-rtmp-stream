FROM jrottenberg/ffmpeg:3.2-scratch
MAINTAINER lampa <github.com/lampaa>

RUN adduser -D -u 1000 node \
    && apk add --no-cache libstdc++ \
    && apk add --no-cache --virtual --update nodejs nodejs-npm

ENV AUTH_REST_SERVICE null
ENV AUTH_BASIC "login:password"
ENV WS_HOST 0.0.0.0
ENV WS_PORT 15571
ENV FFMPEG -vcodec copy -acodec aac -f flv
ENV RTMP_PREFIX null
ENV DEBUG TRUE

COPY server /var/server/

EXPOSE 15571
CMD ["npm start /var/server/"]