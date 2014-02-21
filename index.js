// Visible Secrets Twitter-Bot game for White Night Melbourne February 2014
// Code by written by William Goddard
// Design by William Goddard, Harry Lee, Amani Naseem, Harrison Smith
// Thanks to people helping at Exertion Games Lab: Robert Cercos, Jayden Smith, RMIT

// In this simple twitter bot game, players are given unique codes to wear and associated with their twitter account
// Players direct message these codes to this bot which informs them if and who they have spotted

// Workflow:
//  1. Player follows bot
//  2. Game organizer associates code with player (e.g. DM to bot: "pair $username $code") (pair wilgoddard 3523453)
//  3. Players send in codes to the twitter bot (e.g. DM to bot: "3523453")
//  4. Players request stats (e.g. DM to bot: "stats")

var express = require("express");
var logfmt = require("logfmt");
var app = express();
var mongoose = require('mongoose');
var Schema = mongoose.Schema;

//This is the data schema used by Mongoose for our users.  See http://mongoosejs.com/docs/guide.html
var UserSchema = new Schema({
    uid: String,
    name: String,
    image: String,
    username: String,
    gamecode: String,
    targets: [{ uid: String, username: String, date: { type: Date, default: Date.now } }],
    attackers: [{ uid: String, username: String, date: { type: Date, default: Date.now } }],
    beenSpottedCount: { type: Number, default: 0 }, //this should be the samse as the size of the attackers array (for convenience)
    spottedCount: { type: Number, default: 0 }, //this should be the same as the size of the targets array
    created: { type: Date, default: Date.now }
});

mongoose.connect(process.env.MONGODB_URI); //e.g. mongodb://localhost/visible-secrets
mongoose.model('User', UserSchema);

var User = mongoose.model('User');

//App/express settings
app.use(logfmt.requestLogger());

//twitter codes
//var consumerKey = process.env.TWITTER_CONSUMER_KEY;
//var consumerSecret = process.env.TWITTER_CONSUMER_SECRET;
//
var botKey = process.env.TWITTER_BOT_CONSUMER_KEY; //twitter api key (these variables are stored in the .env run with foreman or on heroku)
var botSecret = process.env.TWITTER_BOT_CONSUMER_SECRET; //twitter api secret
var accessToken = process.env.TWIT_USER_ACCESS_TOKEN; //user access token
var accessTokenSecret = process.env.TWIT_USER_ACCESS_TOKEN_SECRET; //user access token secret

//twitter setup (this is the twitter API client, for the twitter bot)
var Twit = require('twit')
var T = new Twit({
    consumer_key: botKey
  , consumer_secret: botSecret
  , access_token:  accessToken //this access token for VS_HQ
  , access_token_secret: accessTokenSecret
})

//Twitter streams using Twit
var stream = T.stream('user', {})
stream.on('direct_message', function (directMsg) { //unforunately this API does not give much filter control so we have to use logic

    var code = directMsg['direct_message']['text'];     //The message received (usually the unique game code)
    var senderUsername = directMsg['direct_message']['sender']['screen_name']; //the username of the sender e.g. @wilgoddard
    var senderId = directMsg['direct_message']['sender']['id'];  //the unique twitter id (number) - remember twitter users can change usernames, but this isn't handled

    console.log("Got a direct message of " + code + " from " + senderUsername + " who has id " + senderId);

    //First let's process any pair user to code attempts (this is not authenticated, but you could easily add this by requiring senderId == a known uid)
    var explode = code.replace("@", "");
    explode = explode.toLowerCase();
    explode = explode.split(" ");
    if (explode.length == 3 && explode[0] == "pair") { //The DM is definitely a pair command ("pair $string $string")
        console.log("pair message received");
        var pairUsername = explode[1];
        var pairCode = explode[2];
        User.findOne({ username: pairUsername }, function (err, user) { //in order to pair a code to the user, let's check if we've got the username in db
            if (user) {
                var isNewUser = (user.gamecode === undefined); //is this a new pair or repair? good to know for user feedback
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

    //provide some basic stats to users requesting
    if (code.toLowerCase() == "stats") {
        User.findOne({ uid: senderId }, function (err, user) {
            if (user) {
                T.post('direct_messages/new', { user_id: senderId, text: "You have spotted " + user.spottedCount  + " players and been spotted " + user.beenSpottedCount + " times" }, function (err, reply) { })
            }
        })
        return;
    }

    //We can't filter this out - basically went we send out a direct message it comes straight back into the stream
    if (senderId == 2350947464) { //this is the id of the twitter bot
        console.log("I'm not going to process the message I just sent out!");
        return;
    }

    //This is the block processing the code and giving scores and notifications
    User.findOne({ gamecode: code }, function (err, targetUser) {
        if (targetUser) {
            if (senderId == targetUser.uid) {
                
                console.log("targetted yourself!");
                T.post('direct_messages/new', { user_id: senderId, text: "You cannot target yourself silly!" }, function (err, reply) {})

            } else {
                console.log("compromised!");
                User.findOne({ uid: senderId }, function (err, activeUser) {

                    if (err) {
                        console.log(err);
                    } else {
                        //check if the active user has spotted the target before. You can only spot a player once
                        var newSpot = true; 
                        for (var i = 0; i < activeUser.targets.length; ++i) {
                            if (activeUser.targets[i].uid == targetUser.uid) {
                                newSpot = false;
                                break;
                            }
                        }
                        if (newSpot) { 
                            targetUser.beenSpottedCount++;
                            targetUser.attackers.push({ uid: activeUser.uid, username: activeUser.username });
                            targetUser.save(function (err) {
                                if (err) { throw err; }
                            });
                            activeUser.targets.push({ uid: targetUser.uid, username: targetUser.username });
                            activeUser.spottedCount++;
                            activeUser.save(function (err) {
                                if (err) { throw err; }
                            });
                            var status = '@' + targetUser.username + ' was #spotted playing #visiblesecrets by @' + senderUsername;
                            T.post('statuses/update', { status: status }, function (err, reply) { })
                            T.post('direct_messages/new', { user_id: senderId, text: "You spotted @" + targetUser.username + "!" }, function (err, reply) { })
                        } else { //this person has already targetted this player before
                            T.post('direct_messages/new', { user_id: senderId, text: "You've already spotted @" + targetUser.username + "!" }, function (err, reply) { })
                        }
                    }

                })
            }

        } else {
            console.log("couldn't find user");
            T.post('direct_messages/new', { user_id: senderId, text: "Couldn't find the user... be sure just to enter the code!" }, function (err, reply) { })
        }
    })
})

//To start the game, the user follows the bot which notifiies them to get a code from a game organizer
//When the player gets a code from the game organized (search: pair) they can begin playing
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