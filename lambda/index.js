const crypto = require('crypto');
const AWS = require('aws-sdk');
const line = require('@line/bot-sdk');
const moment = require('moment-timezone');
const chrono = require('chrono-node');

const TIME_STRING_MAX_LENGTH = '0000/00/00 00:00:00am - 0000/00/00 00:00:00am'.length;
const TIME_FORMAT_FULL = 'YYYY/M/D H:mm';
const TIME_FORMAT_FROM_MONTH = 'M/D H:mm';
const TIME_FORMAT_FROM_HOUR = 'H:mm';
const TIMEZONE_LIST_URL = 'https://en.wikipedia.org/wiki/List_of_tz_database_time_zones#List';
const TABLE_NAME = 'TimezoneLineBot';

const docClient = new AWS.DynamoDB.DocumentClient({region: 'ap-northeast-1'});
moment.tz.setDefault('UTC');

exports.handler = function (event, context) {
  const body = JSON.parse(event.body);

  // Validate the request header
  if (!validateSignature((event.headers || {})['X-Line-Signature'], body)) {
    return;
  }

  // Proceed only when the message type is text
  if (body.events[0].type != 'message' || body.events[0].message.type != 'text') {
    return;
  }

  // Prepare for reply and response
  const replyToken = body.events[0].replyToken;
  const sendReplyAndReponse = replyText => {
    if (replyText && replyText.length > 0) {
      const replyMessage = {
        type: 'text',
        text: replyText
      };

      // Send back the reply message
      const client = new line.Client({channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN});
      client.replyMessage(replyToken, replyMessage)
        .then(() => {
          console.log(replyMessage);
          const response = {
            statusCode: 200,
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer {${process.env.LINE_CHANNEL_ACCESS_TOKEN}}`,
              'X-Line-Status': 'OK',
            },
            body: '{"result": "completed"}'
          };
          context.succeed(response);
        })
        .catch(error => {
          console.log(error);
        });
    }
  };

  // Process the message
  const chatroomType = body.events[0].source.type;
  const chatroomId = chatroomType === 'user'
    ? body.events[0].source.userId
    : (chatroomType === 'group' ? body.events[0].source.groupId : body.events[0].source.roomId);
  getChatroomFromDB(chatroomId, chatroomType, (error, data) => {
    if (error) {
      sendReplyAndReponse('チャットルームデータの取得でエラーが発生しました');
    } else {
      reply(sendReplyAndReponse, chatroomId, chatroomType, data.Item, body.events[0].message.text);
    }
  });
};

const validateSignature = (signature, body) => {
  return signature == crypto.createHmac('sha256', process.env.LINE_CHANNEL_SECRET)
    .update(JSON.stringify(body))
    .digest('base64');
};

const escapeRegExp = string => {
  return string.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');
};

// The callback function will receive (error, data). The chatroom item is data.Item
const getChatroomFromDB = (id, type, callback) => {
  const chatroomGetParams = {
    TableName: TABLE_NAME,
    Key: {
      Id: id,
      ChatType: type
    }
  };
  docClient.get(chatroomGetParams, callback);
};

// chatroomData can be undefined if the chatroom is not in the DB
const reply = (sendReplyAndReponse, chatroomId, chatroomType, chatroomData, receivedText) => {
  // Timezone commands
  const words = receivedText.replace(/\s\s+/g, ' ').split(' ');
  if (words.length >= 2 && words[0] === 'timezone') {
    switch (words[1]) {
      case 'help':
        sendCommandList(sendReplyAndReponse);
        return;
      case 'all':
        sendAllTimezones(sendReplyAndReponse);
        return;
      case 'list':
        sendTimezoneList(sendReplyAndReponse, chatroomData);
        return;
      case 'now':
        sendCurrentTime(sendReplyAndReponse, chatroomData);
        return;
      case 'add':
        if (words.length >= 3) { // Timezone (words[2]) is specified
          if (words.length >= 5 && words[3] === 'as') {
            addTimezone(sendReplyAndReponse, chatroomId, chatroomType, chatroomData, words[2], words[4]);
          } else {
            addTimezone(sendReplyAndReponse, chatroomId, chatroomType, chatroomData, words[2], null);
          }
        }
        return;
      case 'delete':
        if (words.length >= 3) { // Timezone (words[2]) is specified
          deleteTimezone(sendReplyAndReponse, chatroomData, words[2]);
        }
        return;
      default:
        break;
    }
  }

  // Timezone conversion
  const parsedReceivedText = parseTime(chatroomData, receivedText);
  if (parsedReceivedText.some(element => element.type === 'time')) { // If parsedReceivedText contains time
    // Construct and send reply message
    sendReplyAndReponse(parsedReceivedText.map((element, index) => {
      switch (element.type) {
        case 'text':
          return element.text;
        case 'time':
          const lineBreakBefore = index === 0 ? '' : '\n';
          const lineBreakAfter = index === parsedReceivedText.length - 1 ? '' : '\n';
          return lineBreakBefore
            + chatroomData.Timezones.map(timezoneObject => {
              return parsedResultToTimezoneText(element.time, element.timezone, timezoneObject.timezone);
            }).join('\n')
            + lineBreakAfter;
        default:
          return '';
      }
    }).join(''));
  }
};

const sendCommandList = sendReplyAndReponse => {
  sendReplyAndReponse('timezone all: 全てのタイムゾーン名のリストへのリンクを送ります\n\n'
    + 'timezone list: このチャットルームで登録されたタイムゾーンの一覧を表示します\n\n'
    + 'timezone now: このチャットルームに登録されたタイムゾーンでの現在時刻を表示します\n\n'
    + 'timezone add Asia/Tokyo as jst: Asia/Tokyoというタイムゾーンを「jst」という通称で登録します\n\n'
    + 'timezone delete Asia/Tokyo: Asia/Tokyoというタイムゾーンをこのチャットルームから削除します\n\n'
    + '「jst 8pm」というように時間の前にタイムゾーンの通称をつけると、このチャットルームで登録された他のタイムゾーンに変換します');
};

const sendAllTimezones = sendReplyAndReponse => {
  sendReplyAndReponse(`全てのタイムゾーン名のリストです\n${TIMEZONE_LIST_URL}`);
};

const sendTimezoneList = (sendReplyAndReponse, chatroomData) => {
  if (chatroomData && chatroomData.Timezones.length > 0) { // The chatroom exists and there is at least one timezone
    sendReplyAndReponse(chatroomData.Timezones.map(timezoneObject => {
      return `タイムゾーン: ${timezoneObject.timezone}\n通称: ${timezoneObject.alias}`;
    }).join('\n\n'));
  } else {
    sendReplyAndReponse('このチャットルームにはまだタイムゾーンが登録されていません');
  }
};

const sendCurrentTime = (sendReplyAndReponse, chatroomData) => {
  if (chatroomData && chatroomData.Timezones.length > 0) { // The chatroom exists and there is at least one timezone
    sendReplyAndReponse(chatroomData.Timezones.map(timezoneObject => {
      return timezoneObject.timezone + ' ' + moment.tz(timezoneObject.timezone).format(TIME_FORMAT_FULL);
    }).join('\n'));
  } else {
    sendReplyAndReponse('このチャットルームにはまだタイムゾーンが登録されていません');
  }
};

const addTimezone = (sendReplyAndReponse, chatroomId, chatroomType, chatroomData, timezone, alias) => {
  if (moment.tz.names().includes(timezone)) { // If the timezone is valid
    if (chatroomData) { // The chatroom already exists in the DB
      const newTimezones = chatroomData.Timezones;
      const timezoneIndexInChatroom = chatroomData.Timezones.reduce((accumulator, currentTimezoneObject, index) => {
        if (currentTimezoneObject.timezone === timezone) {
          return index;
        } else {
          return accumulator;
        }
      }, null);
      if (timezoneIndexInChatroom === null) { // The timezone hasn't been registered in the chatroom yet
        newTimezones.push({timezone: timezone, alias: alias ? alias : timezone});
      } else { // The timezone has already been registered in the chatroom
        newTimezones[timezoneIndexInChatroom] = {timezone: timezone, alias: alias ? alias : timezone};
      }
      // Update the timezones
      const updateParams = {
        TableName: TABLE_NAME,
        Key: {
          Id: chatroomId,
          ChatType: chatroomType
        },
        UpdateExpression: 'set Timezones = :t',
        ExpressionAttributeValues:{':t': newTimezones},
        ReturnValues: 'UPDATED_NEW'
      };
      docClient.update(updateParams, (error, data) => {
        if (error) {
          console.log(error);
          sendReplyAndReponse('タイムゾーンの更新でエラーが発生しました');
        } else {
          sendReplyAndReponse(`${timezone}というタイムゾーンが「${alias ? alias : timezone}」という通称で登録されました`);
        }
      });
    } else { // The chatroom doesn't exist in the DB
      const chatroomPutParams = {
        TableName: TABLE_NAME,
        Item: {
          Id: chatroomId,
          ChatType: chatroomType,
          Timezones: [{timezone: timezone, alias: alias ? alias : timezone}]
        }
      };
      docClient.put(chatroomPutParams, (error, data) => {
        if (error) {
          console.log(error);
          sendReplyAndReponse('このチャットルームの登録でエラーが発生しました');
        } else {
          sendReplyAndReponse(`${timezone}というタイムゾーンが「${alias ? alias : timezone}」という通称で登録されました`);
        }
      });
    }
  } else {
    const normalizedTimezone = timezone.toLowerCase().replace(' ', '').replace('_', '').replace('/', '');
    const suggestion = moment.tz.names().reduce((accumulator, currentTimezone) => {
      if (!accumulator) {
        const normalizedCurrentTimezone = currentTimezone.toLowerCase().replace(' ', '').replace('_', '').replace('/', '');
        if (normalizedCurrentTimezone.indexOf(normalizedTimezone) >= 0) {
          return currentTimezone;
        }
      } else {
        return accumulator;
      }
    }, null);
    sendReplyAndReponse('そのような名前のタイムゾーンはありません' + (suggestion ? `\nもしかして: ${suggestion}` : ''));
  }
};

// Timezone is either official name or alias
const deleteTimezone = (sendReplyAndReponse, chatroomData, timezone) => {
  if (chatroomData) { // The chatroom exists in the DB
    const timezoneIndexInChatroom = chatroomData.Timezones.reduce((accumulator, currentTimezoneObject, index) => {
      if (currentTimezoneObject.timezone === timezone || currentTimezoneObject.alias === timezone) {
        return index;
      } else {
        return accumulator;
      }
    }, null);
    if (timezoneIndexInChatroom != null) { // The timezone has been registered in this chatroom
      const newTimezones = chatroomData.Timezones;
      newTimezones.splice(timezoneIndexInChatroom, 1);
      const updateParams = {
        TableName: TABLE_NAME,
        Key: {
          Id: chatroomData.Id,
          ChatType: chatroomData.ChatType
        },
        UpdateExpression: 'set Timezones = :t',
        ExpressionAttributeValues:{':t': newTimezones},
        ReturnValues: 'UPDATED_NEW'
      };
      docClient.update(updateParams, (error, data) => {
        if (error) {
          console.log(error);
          sendReplyAndReponse('タイムゾーンの削除でエラーが発生しました');
        } else {
          sendReplyAndReponse(`${timezone}が削除されました`);
        }
      });
      return;
    }
  }
  // Either the chatroom or the timezone doesn't exist in the DB
  sendReplyAndReponse('このチャットルームにはそのような名前のタイムゾーンは登録されていません');
};

// timezones: value of the Timezones attribute of the chatroom data
const aliasToTimezone = (alias, timezones) => {
  return timezones.reduce((accumulator, currentTimezoneObject) => {
    if (currentTimezoneObject.alias === alias) {
      return currentTimezoneObject.timezone;
    } else {
      return accumulator;
    }
  }, null);
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
const parseTime = (chatroomData, receivedText) => {
  const parsedElements = [];

  // Look for alias in the text
  const aliasRegExp = new RegExp(`(${chatroomData.Timezones.map(timezoneObject => {
    return escapeRegExp(timezoneObject.alias);
  }).join('|')})`, 'gi');
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

      const timezone = aliasToTimezone(aliasMatch.alias, chatroomData.Timezones);
      const referenceDate = moment.tz(timezone);
      const parsedResults = chrono.parse(textBetweenToParse, new Date(
        referenceDate.year(),
        referenceDate.month(),
        referenceDate.date(),
        referenceDate.hour(),
        referenceDate.minute()
      ));
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
  const currentTime = moment.tz(targetTimezone);

  const startTime = moment.tz(chronoToString(parsedResult.start), 'YYYY-M-D H:m', sourceTimezone).tz(targetTimezone);
  const startString = startTime.format(startTime.year() != currentTime.year()
    ? TIME_FORMAT_FULL
    : (startTime.dayOfYear() != currentTime.dayOfYear() ? TIME_FORMAT_FROM_MONTH : TIME_FORMAT_FROM_HOUR)
  );

  if (parsedResult.end) {
    const endTime = moment.tz(chronoToString(parsedResult.end), 'YYYY-M-D H:m', sourceTimezone).tz(targetTimezone);
    const endString = endTime.format(endTime.year() != startTime.year()
      ? TIME_FORMAT_FULL
      : (endTime.dayOfYear() != startTime.dayOfYear() ? TIME_FORMAT_FROM_MONTH : TIME_FORMAT_FROM_HOUR)
    );

    return `${targetTimezone} ${startString}-${endString}`;
  } else {
    return `${targetTimezone} ${startString}`;
  }
};

// Convert Chrono's date object to a string that moment.js can parse
const chronoToString = chronoDate => {
  return `${chronoDate.get('year')}-${chronoDate.get('month')}-${chronoDate.get('day')} ${chronoDate.get('hour')}:${chronoDate.get('minute')}`;
};