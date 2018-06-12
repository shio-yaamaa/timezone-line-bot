require('dotenv').config();

const http = require('http');
const crypto = require('crypto');
const line = require('@line/bot-sdk');
const moment = require('moment-timezone');
const chrono = require('chrono-node');

const TIME_STRING_MAX_LENGTH = '0000/00/00 00:00:00am - 0000/00/00 00:00:00am'.length;
const TIME_FORMAT = 'YYYY/M/D H:mm';
moment.tz.setDefault('UTC');

http.createServer((request, response) => {
  parseRequestBody(request, body => {
    
    // Validate the request header
    if (!validateSignature((request.headers['x-line-signature'] || {}), body)) {
      return;
    }
    
    // Process the received message only when it is a text message
    if (body.events[0].type != 'message' || body.events[0].message.type != 'text') {
      return;
    }
    const replyText = createReplyText(body.events[0].message.text);
    if (replyText) {
      // Construct reply message
      const replyMessage = {
        type: 'text',
        text: replyText
      };
      
      // Send back the reply message
      const client = new line.Client({channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN});
      const replyToken = body.events[0].replyToken;
      client.replyMessage(replyToken, replyMessage)
        .then(() => {
          console.log(replyMessage);
        })
        .catch(error => {
          console.log(error);
        });
    }
    
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Authorization': `Bearer {${process.env.CHANNEL_ACCESS_TOKEN}}`
    });
    response.end();
  });
}).listen(process.env.PORT);

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

const validateSignature = (signature, body) => {
  return signature == crypto.createHmac('sha256', process.env.CHANNEL_SECRET)
    .update(JSON.stringify(body))
    .digest('base64');
};

// Returns null if the bot shouldn't reply
const createReplyText = receivedText => {
  // Timezone commands
  const words = receivedText.replace(/\s\s+/g, ' ').split(' ');
  if (words.length >= 2 && words[0] === 'timezone') {
    switch (words[1]) {
      case 'help':
        return getCommandList();
      case 'all':
        return getAllTimezones();
      case 'list':
        return getTimezoneList();
      case 'now':
        return getCurrentTime();
      case 'add':
        if (words.length >= 3) { // Timezone (words[2]) is specified
          if (words.length >= 5 && words[3] === 'as') {
            return addTimezone(words[2], words[4]);
          } else {
            return addTimezone(words[2], null);
          }
        } else {
          break;
        }
      case 'remove':
        if (words.length >= 3) { // Timezone (words[2]) is specified
          return removeTimezone(words[2]);
        } else {
          break;
        }
      default:
        break;
    }
  }
  
  // Timezone conversion
  const parsedReceivedText = parseTime(receivedText);
  if (parsedReceivedText.some(element => element.type === 'time')) { // If parsedReceivedText contains time
    // Construct reply message
    console.log(parsedReceivedText);
    return parsedReceivedText.map((element, index) => {
      switch (element.type) {
        case 'text':
          return element.text;
        case 'time':
          const targetTimezones = ['Asia/Tokyo', 'America/Los_Angeles', 'UTC'];
          const lineBreakBefore = index === 0 ? '' : '\n';
          const lineBreakAfter = index === parsedReceivedText.length - 1 ? '' : '\n';
          return lineBreakBefore
            + targetTimezones.map(targetTimezone => {
              return parsedResultToTimezoneText(element.time, element.timezone, targetTimezone);
            }).join('\n')
            + lineBreakAfter;
        default:
          return '';
      }
    }).join('');
  }
  
  return null;
};

const escapeRegExp = string => {
  return string.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');
};

const getCommandList = () => {
  return 'timezone all: Send the link to the list of all the timezones\n\n'
    + 'timezone list: Show the list of registered timezones in this chatroom\n\n'
    + 'timezone now: Show the current time in all the timezones registered in this chatroom\n\n'
    + 'timezone add Asia/Tokyo as jst: Add the timezone Asia/Tokyo to this chatroom\'s timezones\n\n'
    + 'timezone remove Asia/Tokyo: Remove the timezone Asia/Tokyo from this chatroom\'s timezones\n\n'
    + 'Put the alias of the timezone before the time to convert it to other timezones';
};

const getAllTimezones = () => {
  return 'link to the list of all timezones';
};

const getTimezoneList = () => {
  return 'list of the registered timezones';
};

const getCurrentTime = () => {
  return 'current time';
};

const addTimezone = (timezone, alias) => {
  if (moment.tz.names().includes(timezone)) { // If timezone exists
    //    if the timezone already exists in the timezone list in this chatroom:
    //      just update the alias
    //    else:
    //      add timezone to the chatroom's timezone list with the specified alias (in the case alias is null, alias should be the same as timezone)
    //    return 'Added timezone as alias'
    return `add ${timezone}` + (alias ? ` as ${alias}` : '');
  } else {
    return 'No such timezone';
  }
};

// Timezone is either official name or alias
const removeTimezone = timezone => {
  
};

const aliasToTimezone = alias => {
  if (alias === 'jst') {
    return 'Asia/Tokyo';
  } else {
    return 'America/Los_Angeles';
  }
};

// parseTime returns an array like this:
// [
//   {
//     type: 'text',
//     text: '私は'
//   },
//   {
//     type: 'time',
//     time: Chrono's ParsedResult,
//     timezone: 'Asia/Tokyo'
//   },
//   {
//     type: 'text',
//     text: 'からできるよー'
//   }
// ];
const parseTime = receivedText => {
  const timezoneAliasList = ['jst', 'pst'];
  const parsedElements = [];
  
  // Look for alias in the text
  const aliasRegExp = new RegExp(`(${timezoneAliasList.map(alias => escapeRegExp(alias)).join('|')})`, 'gi');
  const matchStrings = receivedText.match(aliasRegExp);
  if (matchStrings && matchStrings.length > 0) {
    const aliasMatches = [];
    let regExpOffset = 0;
    for (const matchString of matchStrings) {
    	aliasMatches.push({
    		alias: matchString,
    		index: receivedText.indexOf(matchString, regExpOffset)
    	});
    	regExpOffset = aliasMatches[aliasMatches.length - 1].index + matchString.length;
    }
    
    // Add the text before the first alias to the elements list
    if (aliasMatches[0].index > 0) {
      parsedElements.push({
        type: 'text',
        text: receivedText.substring(0, aliasMatches[0].index)
      });
    }
  
    // Parse individual time
    for (let i = 0; i < aliasMatches.length; i++) {
      const aliasMatch = aliasMatches[i];
      let textBetween = receivedText.substring( // Text between this alias and the next alias
        aliasMatch.index + aliasMatch.alias.length,
        (i < aliasMatches.length - 1) ? aliasMatches[i + 1].index : receivedText.length
      );
      const textBetweenToParse = textBetween.substr(0, TIME_STRING_MAX_LENGTH);
      
      const timezone = aliasToTimezone(aliasMatch.alias);
      const referenceDate = moment.tz(timezone);
      const parsedResults = chrono.parse(textBetweenToParse, new Date(referenceDate.year(), referenceDate.month(), referenceDate.date()));
      if (parsedResults.length === 0 || parsedResults[0].index > 5) { // Consider textBetween a plain text when the parsed part is too far from the alias
        // textBetween is just plain text
        parsedElements.push({
          type: 'text',
          text: aliasMatch.alias + textBetween
        });
      } else {
        // A part of textBetween represents time
        const parsedResult = parsedResults[0];
        parsedElements.push({
          type: 'time',
          time: parsedResult,
          timezone: timezone
        });
        if (textBetween.length - (parsedResult.index + parsedResult.text.length) > 0) { // If there is plain text after the parsed time
          parsedElements.push({
            type: 'text',
            text: textBetween.substring(parsedResult.index + parsedResult.text.length, textBetween.length)
          });
        }
      }
    }
    return parsedElements;
  } else { // No alias found
    return [{
      type: 'text',
      text: receivedText
    }];
  }
};

const parsedResultToTimezoneText = (parsedResult, sourceTimezone, targetTimezone) => {
  const startString = moment.tz(chronoToString(parsedResult.start), 'YYYY-M-D H:m', sourceTimezone).tz(targetTimezone).format(TIME_FORMAT);
  if (parsedResult.end) {
    const endString = moment.tz(chronoToString(parsedResult.end), 'YYYY-M-D H:m', sourceTimezone).tz(targetTimezone).format(TIME_FORMAT);
    // TODO: Delete redundant information in endString
    return `${targetTimezone} ${startString} - ${endString}`;
  } else {
    return `${targetTimezone} ${startString}`;
  }
};

// Convert Chrono's date object to a string that moment.js can parse
const chronoToString = chronoDate => {
  return `${chronoDate.get('year')}-${chronoDate.get('month')}-${chronoDate.get('day')} ${chronoDate.get('hour')}:${chronoDate.get('minute')}`;
};