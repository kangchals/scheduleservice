"use strict";

require('date-utils');

exports.run = function(container) {

    container.getService('MONGODB').then(function (mongodbService) {

        var query = {
            where : {
                next : {
                    '$lt' : {
                        '$ISODate' : new Date()
                    }
                }
            }
        };

        mongodbService.send('find', {collectionName : 'schedule', query: query}, function (err, docs) {

            if (err)
                return console.log(err.message);

            if(!docs || !docs.data || docs.data.length <= 0)
                return;

            docs.data.forEach(function (doc) {
                var updateDoc = {};

                // calc next

                if(doc.repeat) {

                    if(doc.repeat.interval)
                        updateDoc.next = { '$ISODate' : (new Date(doc.next)).addMinutes(doc.repeat.interval) };

                } else {

                    updateDoc.next = null;
                }

                // update

                if(doc.count)
                    updateDoc.count = doc.count + 1;
                else
                    updateDoc.count = 1;

                mongodbService.send('update', {collectionName : 'schedule', query : {where : {objectId : doc.objectId}}, data : updateDoc}, function(err, doc) {

                    if(err) {

                        if(err.code === 10147)
                            return addScheduleLog(doc.objectId, {
                                index : updateDoc.count,
                                error : 'ResourceNotFound'
                            }, container);

                        return addScheduleLog(doc.objectId, {
                            index : updateDoc.count,
                            error : err.message
                        }, container);
                    }
                });

                // run
                if(doc.function) {

                    mongodbService.send('findOne', {collectionName : 'apps', query : {where : {objectId : doc._appid}}}, function(err, app) {

                        if(err) {

                            return addScheduleLog(doc.objectId, {
                                index : updateDoc.count,
                                error : err.message
                            }, container);
                        }


                        if(process.env.NODE_ENV === 'test') {

                            app.applicationId = 'supertoken';
                            app.javascriptKey = 'supertoken';
                            app.masterKey = 'supertoken';
                        }

                        container.getService('FUNCTIONS').then(function (functionService) {

                            var startDt = new Date();

                            functionService.send('run', {
                                appid : doc._appid,
                                functionName : doc.function,
                                parameter : doc.parameter,
                                applicationId : app.applicationId,
                                javascriptKey : app.javascriptKey,
                                masterKey : app.masterKey
                            }, function(err, log) {

                                var endDt = new Date();

                                if(err) {

                                    return addScheduleLog(doc.objectId, {
                                        index : updateDoc.count,
                                        error : err.message
                                    }, container);
                                }

                                addScheduleLog(doc.objectId, {

                                    startedAt : startDt,
                                    endedAt : endDt,
                                    time : endDt - startDt,
                                    index : updateDoc.count,
                                    response : log.data
                                }, container);

                            });
                        }).fail(function (err) {

                            addScheduleLog(doc.objectId, {
                                index : updateDoc.count,
                                error : err.message
                            }, container);
                        });
                    });
                }
            });
        });
    }).fail(function (err) {

        console.log(err.message);
    });
};

function addScheduleLog(id, data, container) {

    container.getService('MONGODB').then(function (mongodbService) {

        mongodbService.send('update', {collectionName : 'schedule', query : {where : {objectId : id}}, data : { $addToSet : { log : data}}}, function(err, doc) {

        });

    }).fail(function (err) {

        console.log(err.message);
    });
}
