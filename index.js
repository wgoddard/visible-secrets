var express = require("express");
var logfmt = require("logfmt");
var app = express();
var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var UserSchema = new Schema({
    provider: String,
    uid: String,
    name: String,
    image: String,
    username: String,
    gamecode: String,
    created: { type: Date, default: Date.now }
});

mongoose.connect(process.env.MONGODB_URI);
mongoose.model('User', UserSchema);

var User = mongoose.model('User');

//App/express settings
app.use(logfmt.requestLogger());

//twitter codes
//var consumerKey = process.env.TWITTER_CONSUMER_KEY;
//var consumerSecret = process.env.TWITTER_CONSUMER_SECRET;
//
var botKey = process.env.TWITTER_BOT_CONSUMER_KEY;
var botSecret = process.env.TWITTER_BOT_CONSUMER_SECRET;
var accessToken = process.env.TWIT_USER_ACCESS_TOKEN;
var accessTokenSecret = process.env.TWIT_USER_ACCESS_TOKEN_SECRET;

//twitter setup (this is the twitter API client, for the twitter bot)
var Twit = require('twit')
var T = new Twit({
    consumer_key: botKey
  , consumer_secret: botSecret
  , access_token:  accessToken//this access token for VS_HQ
  , access_token_secret: accessTokenSecret
})

//Twitter streams

var stream = T.stream('user', {})
stream.on('direct_message', function (directMsg) {

    //The unique game code of the opponent
    var code = directMsg['direct_message']['text'];
    var senderUsername = directMsg['direct_message']['sender']['screen_name'];
    var senderId = directMsg['direct_message']['sender']['id'];

    console.log("Got a direct message of " + code + " from " + senderUsername + " who has id " + senderId);

    //First let's process any pair user to code attempts (this is not authenticated, but you could easily add this by requiring senderId == a known uid
    var explode = code.replace("@", "");
    explode = explode.toLowerCase();
    explode = explode.split(" ");
    if (explode.length == 3 && explode[0] == "pair") {
        console.log("pair message received");
        var pairUsername = explode[1];
        var pairCode = explode[2];
        User.findOne({ username: pairUsername }, function (err, user) {
            if (user) {
                var isNewUser = (user.gamecode === undefined);
                user.gamecode = pairCode;
                user.save(function (err) {
                    if (err) { throw err; }
                });

                if (isNewUser) {
                    T.post('statuses/update', { status: "@" + pairUsername + " welcome to #visiblesecrets" }, function (err, reply) { })
                    T.post('direct_messages/new', { user_id: senderId, text: "Paired @" + pairUsername + " with code " + pairCode +" they can play!"}, function (err, reply) { })
                } else {
                    T.post('direct_messages/new', { user_id: senderId, text: "Re-paired @" + pairUsername + " with code " + pairCode }, function (err, reply) { })
                }
            } else {
                T.post('direct_messages/new', { user_id: senderId, text: "Couldn't find the user @" + pairUsername + " in the database to pair" }, function (err, reply) {})
            }
        })
        return; //don't process other messages (yes should branch or something cleaner ;) )
    }

    if (senderId == 2350947464) { //this is the id of the twitter bot
        console.log("I'm not going to process the message I just sent out!");
        return;
    }

    User.findOne({ gamecode: code }, function (err, user) {
        if (user) {
            if (senderId == user.uid) {
                
                console.log("targetted yourself!");
                T.post('direct_messages/new', { user_id: senderId, text: "You cannot target yourself silly!" }, function (err, reply) {})

            } else {
                console.log("compromised!");
                var status = '@' + user.username + ' you were #spotted playing #visiblesecrets by @' + senderUsername;
                T.post('statuses/update', { status: status }, function (err, reply) { })
                T.post('direct_messages/new', { user_id: senderId, text: "You spotted @" + user.username + "!" }, function (err, reply) { })

                //need to record the compromise, count it, and make sure it doesn't happen with the same people again
            }

        } else {
            console.log("couldn't find user");
            T.post('direct_messages/new', { user_id: senderId, text: "Couldn't find the user... be sure just to enter the code!" }, function (err, reply) { })
        }
    })
})

stream.on('follow', function (followEvent) {

    var id = followEvent['source']['id'];

    console.log("About to follow back " + id);

    T.post('friendships/create', { id: id }, function (err, reply) {

        if (err) {
            console.log(err);
        } else {
            console.log("Created a friendship with " + id);
        }

        User.findOne({ uid: id }, function (err, user) {
            if (user) {
                if (user.gamecode === undefined) {
                    T.post('direct_messages/new', { user_id: id, text: "Get a code from the organizers! So you can play #visiblesecrets" }, function (err, reply) {
                        console.log("Send a DM to " + id);
                        if (err) {
                            console.log(err);
                        }
                    })
                } else {
                    T.post('direct_messages/new', { user_id: id, text: "Welcome back to #visiblesecrets! Happy spotting!" }, function (err, reply) {
                        console.log("Send a DM to " + id);
                        if (err) {
                            console.log(err);
                        }
                    })
                }
            } else {
                var user = new User();
                user.provider = "twitter";
                user.uid = id;
                user.username = followEvent['source']['screen_name'].toLowerCase();
                user.name = followEvent['source']['name'];
                user.image = followEvent['source']['profile_image_url'];;
                user.save(function (err) {
                    if (err) { throw err; }
                    console.log("Added " + user.username + " to db");
                });
                T.post('direct_messages/new', { user_id: id, text: "Get a code from the organizers! So you can play #visiblesecrets" }, function (err, reply) {
                    console.log("Send a DM to " + id);
                    if (err) {
                        console.log(err);
                    }
                })
            }
        })

    })
})


var port = Number(process.env.PORT || 5000);
app.listen(port, function() {
    console.log("Listening on " + port);
});