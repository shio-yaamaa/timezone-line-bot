require('dotenv').config();

const http = require('http');
const crypto = require('crypto');
const line = require('@line/bot-sdk');

http.createServer((request, response) => {
  parseRequestBody(request, body => {
    console.log(request.headers['x-line-signature']);
    console.log(body.events[0]);
    
    // Validate the request header
    if (!validate_signature((request.headers['x-line-signature'] || {}), body)) {
      return;
    }
    
    // Process the received message only when
    if (body.events[0].type != 'message' || body.events[0].message.type != 'text') {
      return;
    }
    const receivedMessage = body.events[0].message.text;
    console.log(receivedMessage);
    
    // Construct reply message
    const replyMessage = {
      type: 'text',
      text: 'Hello Shiori'
    };
    
    // Send back the reply message
    const client = new line.Client({
      channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN
    });
    const replyToken = body.events[0].replyToken;
    client.replyMessage(replyToken, replyMessage)
      .then(() => {
        let lambdaResponse = {
          statusCode: 200,
          headers: {'X-Line-Status': 'OK'},
          body: '{"result":"completed"}'
        };
        context.succeed(lambdaResponse);
      })
      .catch((err) => {
      });
    
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Authorization': `Bearer {${process.env.CHANNEL_ACCESS_TOKEN}}`
    });
    response.end();
  });
}).listen(process.env.PORT); // Listens on port 8080

const parseRequestBody = (request, callback) => {
  let body = '';

  request.on('data', data => {
    body += data;
    if (body.length > 1e6) {
      request.connection.destroy();
    }
  });

  request.on('end', () => {
    callback(JSON.parse(body));
  });
};

const validate_signature = (signature, body) => {
  return signature == crypto.createHmac('sha256', process.env.CHANNEL_SECRET)
    .update(JSON.stringify(body))
    .digest('base64');
};