/**
 *  Copyright (c) 2017-present, Facebook, Inc.
 *  All rights reserved.
 *
 *  This source code is licensed under the license found in the
 *  LICENSE file in the root directory of this source tree.
 */
const log4js = require('log4js');
log4js.configure({
  appenders: {
    'console': { type: 'console' },
    'file': { type: 'file', filename: '/var/logs/web-rtmp-server.log' }
  },
  categories: {
    default: { appenders: ['file', 'console'], level: 'DEBUG' },
  }
});

const logger = log4js.getLogger("ws-rtmp");

const child_process = require('child_process');
const express = require('express');
const WebSocketServer = require('ws').Server;
const http = require('http');
const app = express();
const auth = require('basic-auth');

//
const AUTH_TYPES = ["NONE", "BASIC", "TOKEN"];

// variables
const AUTH_TYPE = AUTH_TYPES.indexOf(process.env.AUTH_TYPE.toUpperCase()) >= 0
    ? AUTH_TYPES[AUTH_TYPES.indexOf(process.env.AUTH_TYPE.toUpperCase())]
    : AUTH_TYPES[0];
const AUTH_BASIC = process.env.AUTH_BASIC.split(":");
const AUTH_REST_SERVICE = process.env.AUTH_REST_SERVICE;
const WS_HOST = process.env.WS_HOST;
const WS_PORT = parseInt(process.env.WS_PORT);
const FFMPEG  = process.env.FFMPEG;
const RTMP_PREFIX = process.env.RTMP_PREFIX;
const DEBUG = (process.env.DEBUG.toLowerCase() === "true");

logger.level = DEBUG ? 'debug' : 'info';

logger.info("Prepare configs");
logger.info("AUTH_TYPE: " + AUTH_TYPE);
logger.info("AUTH_BASIC: " + AUTH_BASIC);
logger.info("AUTH_REST_SERVICE: " + AUTH_REST_SERVICE);
logger.info("WS_HOST: " + WS_HOST);
logger.info("WS_PORT: " + WS_PORT);
logger.info("FFMPEG: " + FFMPEG);
logger.info("RTMP_PREFIX: " + RTMP_PREFIX);
logger.info("DEBUG: " + DEBUG);

const server = http.createServer(app).listen(WS_PORT, WS_HOST, () => {
  logger.info("Start http server at " + WS_HOST + ":" + WS_PORT + ", wait connections...");
});

const wss = new WebSocketServer({
  server: server
});

app.use((req, res, next) => {
  if(AUTH_TYPE === "NONE") {
    logger.debug('HTTP Request: ' + req.method + ' ' + req.originalUrl);
    return next();
  }
  else if(AUTH_TYPE === "BASIC") {
    let user = auth(req);

    if (user === undefined || user['name'] !== AUTH_BASIC[0] || user['pass'] !== AUTH_BASIC[1]) {
      res.statusCode = 401;
      res.setHeader('WWW-Authenticate', 'Basic realm="Node"');
      res.end('Unauthorized');

      if(user !== undefined) {
        logger.warn('HTTP Bad Request: ' + req.method + ' ' + req.originalUrl + ' ' + user['name'] + ':' + user['pass']);
      }
      else {
        logger.warn('HTTP Bad Request: ' + req.method + ' ' + req.originalUrl);
      }
    }
    else {
      logger.debug('HTTP Request: ' + req.method + ' ' + req.originalUrl);
      return next();
    }
  }
  else if(AUTH_TYPE === "TOKEN") {
    return next();
  }
});

app.use(express.static(__dirname + '/www'));

wss.on('connection', (ws) => {
  // Ensure that the URL starts with '/rtmp/', and extract the target RTMP URL.
  let match;
  if ( !(match = ws.upgradeReq.url.match(/^\/rtmp\/(.*)$/)) ) {
    ws.terminate(); // No match, reject the connection.
    return;
  }

  const rtmpUrl = decodeURIComponent(match[1]);

  const ffmpeg = child_process.spawn('ffmpeg', [
    // Facebook requires an audio track, so we create a silent one here.
    // Remove this line, as well as `-shortest`, if you send audio from the browser.
    //'-f', 'lavfi', '-i', 'anullsrc',

    // FFmpeg will read input video from STDIN
    '-i', '-',

    // Because we're using a generated audio source which never ends,
    // specify that we'll stop at end of other input.  Remove this line if you
    // send audio from the browser.
    //'-shortest',

    '-vcodec', 'libx264',
    '-acodec', 'aac',
    '-f', 'flv',
    rtmpUrl
  ]);

  // If FFmpeg stops for any reason, close the WebSocket connection.
  ffmpeg.on('close', (code, signal) => {
    logger.debug('FFmpeg child process closed, code ' + code + ', signal ' + signal);
    ws.terminate();
  });

  // Handle STDIN pipe errors by logging to the console.
  // These errors most commonly occur when FFmpeg closes and there is still
  // data to write.  If left unhandled, the server will crash.
  ffmpeg.stdin.on('error', (e) => {
    logger.error('FFmpeg STDIN Error', e);
  });

  // FFmpeg outputs all of its messages to STDERR.  Let's log them to the console.
  ffmpeg.stderr.on('data', (data) => {
    logger.debug('FFmpeg STDERR:', new Buffer(data).toString('utf8'));
  });

  // When data comes in from the WebSocket, write it to FFmpeg's STDIN.
  ws.on('message', (msg) => {
    logger.debug('Write Data', msg);
    ffmpeg.stdin.write(msg);
  });

  // If the client disconnects, stop FFmpeg.
  ws.on('close', (e) => {
    ffmpeg.kill('SIGINT');
    logger.debug('close ws, stop ffmpeg');
  });
});