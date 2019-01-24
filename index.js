
'use strict';
 
const functions = require('firebase-functions');
const {WebhookClient} = require('dialogflow-fulfillment');
const {Card, Suggestion} = require('dialogflow-fulfillment');
const http = require('http'); 
const https = require('https'); 
const crypto = require('crypto');
const yandexMapApiHost = 'search-maps.yandex.ru';
const yandexMapApiKey = 'ad916bd9-1da4-470b-b83d-1db9007f61cf';
const yandexGeoCodeApiHost = 'geocode-maps.yandex.ru';
const yandexGeoCodeApiKey = '2ed59f1e-14d8-4c25-9811-9571046d08ff';


process.env.DEBUG = 'dialogflow:debug'; // enables lib debugging statements

const admin = require('firebase-admin');
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  databaseURL: 'ws://yrbot-3efc8.firebaseio.com/',
});

function md5(string) {
    return crypto.createHash('md5').update(string).digest('hex');
}

function createYandexMapApiPath(text) {
    return '/v1/?text=' + encodeURIComponent(text) + '&lang=ru_RU&apikey=' + yandexMapApiKey;
}

function createYandexGeoCodeApiPath(x, y) {
    return '/1.x/?apikey='+yandexGeoCodeApiKey+ '&format=json&geocode=' + x + ',' + y;
}

function countYandexMapApiResponces(response) {
    if (response === null 
        || response === undefined 
        || response.properties === null 
        || response.properties === undefined
        || response.properties.ResponseMetaData === null 
        || response.properties.ResponseMetaData === undefined 
        || response.properties.ResponseMetaData.SearchResponse === null 
        || response.properties.ResponseMetaData.SearchResponse === undefined 
        || response.properties.ResponseMetaData.SearchResponse.found === null
        || response.properties.ResponseMetaData.SearchResponse.found === undefined) {
            console.log("Incorrect json format\n expected *.properties.ResponseMetaData.SearchResponse.found,\n but found " + JSON.stringify(response));
            return 0;
        }
    return response.properties.ResponseMetaData.SearchResponse.found;
}

function getYandexMapCoordinates(response) {
    if (response === null 
        || response === undefined 
        || response.properties === null 
        || response.properties === undefined
        || response.properties.ResponseMetaData.SearchResponse === null 
        || response.properties.ResponseMetaData.SearchResponse === undefined 
        || response.properties.ResponseMetaData.SearchResponse.found === null
        || response.properties.ResponseMetaData.SearchResponse.found === undefined
        || response.properties.ResponseMetaData.SearchResponse.found === 0
        || response.features === null
        || response.features === undefined 
        || response.features[0] === null
        || response.features[0] === undefined 
        || response.features[0].geometry === null
        || response.features[0].geometry === undefined
        || response.features[0].geometry.coordinates === null
        || response.features[0].geometry.coordinates === undefined) {
            return null;
        }
    return response.features[0].geometry.coordinates;
}

function getGeoObjectForDistrict(records) {
    if (records === null || records === undefined) {
        return null;
    }
    for (var i = 0; i < records.length; i++) {
        if (records[i] !== null
            && records[i] !== undefined
            && records[i].GeoObject !== null
            && records[i].GeoObject !== undefined
            && records[i].GeoObject.metaDataProperty !== null
            && records[i].GeoObject.metaDataProperty !== undefined
            && records[i].GeoObject.metaDataProperty.GeocoderMetaData !== null
            && records[i].GeoObject.metaDataProperty.GeocoderMetaData !== undefined
            && records[i].GeoObject.metaDataProperty.GeocoderMetaData.kind !== null
            && records[i].GeoObject.metaDataProperty.GeocoderMetaData.kind !== undefined
            && records[i].GeoObject.metaDataProperty.GeocoderMetaData.kind === 'district'
            && records[i].GeoObject.name !== null
            && records[i].GeoObject.name !== null
            && records[i].GeoObject.name.indexOf('район') !== -1) {
            return records[i].GeoObject.name;
        }
    }
    return null;
}


function getYandexGeoCodeDistrict(data) {
    if (data !== null
        && data !== undefined
        &&  data.response !== null
        &&  data.response !== undefined
        &&  data.response.GeoObjectCollection !== null
        &&  data.response.GeoObjectCollection !== undefined
        && data.response.GeoObjectCollection.featureMember !== null
        && data.response.GeoObjectCollection.featureMember !== undefined) {
            let district = getGeoObjectForDistrict(data.response.GeoObjectCollection.featureMember);
            district = district.replace(' район','');
            return district;
        }
    return null;
}


function parseHttpResponse(output) {
    var offers = JSON.parse(output);
    if (offers.length === 0) {
        return "К сожелению, таких предложений не нашлось";
    }
    var results = "";
    for(var i = 0; i < offers.length; i++) {
        results = results + offers[i].url + "\n";
    }
    return results;
}

function callYandexGeoCodeApi(x, y) {
    return new Promise((resolve, reject) => {
        let path = createYandexGeoCodeApiPath(x, y);
        console.log('API Request: ' + yandexGeoCodeApiHost + path);
        https.get({host: yandexGeoCodeApiHost, path: path}, (res) => {
            let body = '';
            res.on('data', (d) => { body += d; });
            res.on('end', () => {
                console.log(JSON.stringify(body));
                let response = JSON.parse(body);
                let output = getYandexGeoCodeDistrict(response);
                console.log('District: ' + output);
                resolve(output);
            });
            res.on('error', (error) => {
                console.log(`Error calling YandexGeoCodeApi: ${error}`);
                reject();
            });
        });
    });
}

function callYandexMapApiForAddress(text) {
  return new Promise((resolve, reject) => {
    let path = createYandexMapApiPath(text);
    console.log('API Request: ' + yandexMapApiHost + path);

    https.get({host: yandexMapApiHost, path: path}, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        console.log(JSON.stringify(body));
        let response = JSON.parse(body);
        let output;
        if (countYandexMapApiResponces(response) === 0) {
            output = null;
        }
        else {
            let coordinates = getYandexMapCoordinates(response);
            if (coordinates === null 
                || coordinates === undefined
                || coordinates.length < 2) {
                    output = null;
                    resolve(output);
                }
            else {
                callYandexGeoCodeApi(coordinates[0], coordinates[1]).then((res) => {
                    output = res;
                    console.log("Yandex map:" + text + " " + output);
                    resolve(output);
                }).catch(() => {
                    output = null;
                    resolve(output);
                });
            }
        }
      });
      res.on('error', (error) => {
        console.log(`Error calling YandexMapApiForAddress: ${error}`);
        reject();
      });
    });
  });
}

function defaultResponse(response, request) {
    response.json({ 'fulfillmentText': request.body.queryResult.fulfillmentText });
}

function setField(field, sessionIdHash, value) {
    admin.database().ref(field).transaction((bd) => {
        if(bd !== null) {
            if (bd[sessionIdHash] === undefined
                && bd[sessionIdHash] === null) {
                bd[sessionIdHash] = {};
            }
             bd[sessionIdHash] = value;
       }
       return bd;
    }, function(error, isSuccess) {
        console.log('Set '+ field +' with sessionIdHash = ' + sessionIdHash + ': '  + isSuccess);
    });
}

function clear(request) {
    var sessionIdHash = md5(request.body.session);
    setField('sessionInfo', sessionIdHash, {});
    setField('sessionResponses', sessionIdHash, {});
}

function min(array) {
    var min = 0;
    for (var i = 0; i < array.length; i++) {
        if (min === 0 || array[i].cost < min) {
            min = array[i].cost;
        }
    }
    return min;
}


function max(array) {
    var max = 0;
    for (var i = 0; i < array.length; i++) {
        if (array[i].cost > max) {
            max = array[i].cost;
        }
    }
}



function addParams(bd, info, sessionIdHash, district) {
    
    
    
    if (info.lift !== undefined && info.lift !== null && info.lift !== "") {
        bd.sessionInfo[sessionIdHash].lift = true;
    }
    
    if (info.concierge !== undefined && info.concierge !== null && info.concierge !== "" ) {
        bd.sessionInfo[sessionIdHash].concierge = true;
    }
    
    if (info.wantedFloor !== undefined 
        && info.wantedFloor !== null 
        && info.wantedFloor !== ""
        && info.wantedFloor.length !== 0) {
            bd.sessionInfo[sessionIdHash].wantedFloor = info.wantedFloor;
    }
    
    if (info.unwantedFloor !== undefined 
        && info.unwantedFloor !== null 
        && info.unwantedFloor !== "" 
        && info.unwantedFloor.length !==  0) {
            bd.sessionInfo[sessionIdHash].unwantedFloor = info.unwantedFloor;
    }
    
    if (info.park !== undefined && info.park !== null && info.park !== "" ) {
        bd.sessionInfo[sessionIdHash].park = true;
    }
    
    if (info.maxCountRooms !== undefined && info.maxCountRooms !== null && info.maxCountRooms !== "") {
        bd.sessionInfo[sessionIdHash].maxCountRooms  = info.maxCountRooms;
    }

    if (info.minCountRooms !== undefined && info.minCountRooms !== null && info.minCountRooms !== "") {
        bd.sessionInfo[sessionIdHash].minCountRooms  = info.minCountRooms;
    }
    
    if (info.countRooms !== undefined && info.countRooms !== null && info.countRooms.length !== 0) {
        bd.sessionInfo[sessionIdHash].minCountRooms = info.countRooms[0];
        bd.sessionInfo[sessionIdHash].maxCountRooms = info.countRooms[0];
    }
    if (info.cheaper !== undefined && info.cheaper !== null && info.cheaper !== "" ) {
        var dec = 1;
        var maxCost = 0;
        if (info.decreasedSize !== undefined && info.decreasedSize !== null && info.decreasedSize !== ""){
            dec = info.decreasedSize;
        }
        if (bd.sessionResponses[sessionIdHash] !== null
            && bd.sessionResponses[sessionIdHash] !== undefined) {
                maxCost = min(bd.sessionResponses[sessionIdHash]);
        }
        bd.sessionInfo[sessionIdHash].maxCost = maxCost - dec;
        if (bd.sessionInfo[sessionIdHash].maxCost < bd.sessionInfo[sessionIdHash].minCost) {
            bd.sessionInfo[sessionIdHash].minCost=null;
        }
    }
        
        
    if (info.expensive !== undefined && info.expensive !== null && info.expensive !== "" ) {
        var inc = 1;
        var minCost = 0;
        if (info.increasedSize !== undefined && info.increasedSize !== null && info.increasedSize !== ""){
            inc = info.increasedSize ;
        }
        
         if (bd.sessionResponses[sessionIdHash] !== null
            && bd.sessionResponses[sessionIdHash] !== undefined) {
                minCost = max(bd.sessionResponses[sessionIdHash]);
        }
        bd.sessionInfo[sessionIdHash].minCost = minCost+inc ;
        if (bd.sessionInfo[sessionIdHash].maxCost < bd.sessionInfo[sessionIdHash].minCost) {
            bd.sessionInfo[sessionIdHash].maxCost=null;
        }
    }
            
    if (info.maxCost !== undefined &&info.maxCost !== null &&info.maxCost !== "") {
        bd.sessionInfo[sessionIdHash].maxCost = info.maxCost;
    }
    
    if (info.typeDeal !== undefined &&info.typeDeal !== null &&info.typeDeal !== "") {
        bd.sessionInfo[sessionIdHash].typeDeal = info.typeDeal;
    }
    
    if (info.firstApartment !== undefined &&
        info.firstApartment !== null
        &&info.firstApartment !== "") {
        bd.sessionInfo[sessionIdHash].firstApartment= info.firstApartment;
    }
    
    if (info.credit !== undefined &&info.credit !== null &&info.credit !== "") {
        bd.sessionInfo[sessionIdHash].credit = info.credit;
    }
    
    if (info.minCost !== undefined &&info.minCost !== null &&info.minCost !== "") {
        bd.sessionInfo[sessionIdHash].minCost = info.minCost;
    }
    
    if (info.metro !== undefined &&info.metro !== null &&info.metro !== "") {
        bd.sessionInfo[sessionIdHash].metro = info.metro;
    }
    
    if (district !== undefined && district !== null && district !== "") {
        bd.sessionInfo[sessionIdHash].district = [district];
    }
    
    if (info.district !== undefined &&info.district !== null &&info.district !== ""
       &&info.district.length !== 0) {
        bd.sessionInfo[sessionIdHash].district = info.district;
    }
    
    
    return bd;
}


function getDistrict(request) {
    return new Promise((resolve, reject) => {
        var sessionIdHash = md5(request.body.session);
        if (request.body.queryResult.outputContexts.length >= 0 &&
            request.body.queryResult.outputContexts[0].parameters !== null && 
            request.body.queryResult.outputContexts[0].parameters !== undefined) {
                let info = request.body.queryResult.outputContexts[0].parameters;
                if (info.address !== undefined && info.address !== null && info.address !== "") {
                    callYandexMapApiForAddress(info.address).then((district) => {
                        resolve(district);
                    }).catch((error) => {
                        console.log('ERROR: ' + error);
                        resolve(null);
                    });
                }
                else {
                    resolve(null);
                }
        }
        else {
            resolve(null);
        }
    });
}



function saveInfo(request, district) {
    admin.database().ref().transaction((session) => {
        if(session !== null && session.sessionInfo !== null) {
            var sessionIdHash = md5(request.body.session);
            if (session.sessionInfo[sessionIdHash] === undefined) {
                session.sessionInfo[sessionIdHash] = {};
            }
            if (request.body.queryResult.outputContexts.length >= 0 &&
                request.body.queryResult.outputContexts[0].parameters !== null && 
                request.body.queryResult.outputContexts[0].parameters !== undefined) {
                    session = addParams(session,
                                request.body.queryResult.outputContexts[0].parameters,
                                sessionIdHash, district);
                }
        }
        return session;
    }, function(error, isSuccess) {
        console.log('Updation session Info with session = ' + request.body.session + ': '  + isSuccess);
    });
}


function callServer(sessionInfo) {
      return new Promise((resolve, reject) => {
            sessionInfo.count="3";
            const data = JSON.stringify(sessionInfo);
            console.log("POST Request Body:" + data);
            const options = {
                host: '35.227.52.98',
                port: 8000,
                path: '/get',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data)
                }
            };
            var req = http.request(options, (res) => {
                        console.log(`statusCode: ${res.statusCode}`);
                        let body = '';
                        res.on('data', (d) => { body += d; }); // store each response chunk
                        res.on('end', () => {
                            resolve(body);
                         });
                        res.on('error', (error) => {
                            console.log(`Error : ${error}`);
                            reject();
                        });
            });
            req.write(data);
            req.end();
      });
  }




function getApartment(request, response) {
      var sessionIdHash = md5(request.body.session);
      admin.database().ref('sessionInfo').transaction((sessionInfo) => {
      if(sessionInfo !== null) {
        if (sessionInfo[sessionIdHash] !== undefined &&
            sessionInfo[sessionIdHash] !== null) {
            callServer(sessionInfo[sessionIdHash]).then((output) => {
                setField('sessionResponses', sessionIdHash, JSON.parse(output));
                response.json({ 'fulfillmentText': parseHttpResponse(output) }); 
             }).catch((error) => {
                console.log('ERROR: ' + error);
                response.json({ 'fulfillmentText': `ошибка соединения с сервером` });
        });
        }
      }
      return sessionInfo;
    }, function(error, isSuccess) {
      console.log('getApartment success: ' + isSuccess);
    });
  }
  
exports.dialogflowFirebaseFulfillment = functions.https.onRequest((request, response) => {
  console.log('Dialogflow Request headers: ' + JSON.stringify(request.headers));
  console.log('Dialogflow Request body: ' + JSON.stringify(request.body));
  const agent = new WebhookClient({ request, response });
 
  
  
 getDistrict(request)
 .then((district) => {
    console.log("MAIN DISTRICT" + district);
    saveInfo(request, district);
    if (request.body.queryResult.intent.displayName == 'Location Intent' ||
        request.body.queryResult.intent.displayName == 'Improvement Intent') {
            getApartment(request, response);
    }
    else if (request.body.queryResult.intent.displayName == 'Default Welcome Intent') {
      clear(request);
      defaultResponse(response, request);
    }
     else {
        defaultResponse(response, request);
    }
    });
});
