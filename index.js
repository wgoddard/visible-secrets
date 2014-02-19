var express = require("express");
var logfmt = require("logfmt");
var app = express();
var passport = require('passport')
  , TwitterStrategy = require('passport-twitter').Strategy;
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
app.use(express.cookieParser());
app.use(express.session({ secret: process.env.SESSION_SECRET }));

app.use(passport.initialize());
app.use(passport.session());
app.use(logfmt.requestLogger());

//twitter codes
var consumerKey = process.env.TWITTER_CONSUMER_KEY;
var consumerSecret = process.env.TWITTER_CONSUMER_SECRET;
//
var botKey = process.env.TWITTER_BOT_CONSUMER_KEY;
var botSecret = process.env.TWITTER_BOT_CONSUMER_SECRET;
var accessToken = process.env.TWIT_USER_ACCESS_TOKEN;
var accessTokenSecret = process.env.TWIT_USER_ACCESS_TOKEN_SECRET;


//Passport handles the Twitter user authentication (not the twitter bot)
passport.use(new TwitterStrategy({
    consumerKey: consumerKey,
    consumerSecret: consumerSecret,
    callbackURL: process.env.TWITTER_CALLBACK
},
  function (token, tokenSecret, profile, done) {
      console.log(profile);
      User.findOne({ uid: profile.id }, function (err, user) {
          if (user) {
              done(null, user);
          } else {
              var user = new User();
              user.provider = "twitter";
              user.uid = profile.id;
              user.username = profile.username;
              user.name = profile.displayName;
              user.image = profile._json.profile_image_url;
              user.save(function (err) {
                  if (err) { throw err; }
                  done(null, user);
              });
          }
      })
  }
));

passport.serializeUser(function (user, done) {
    done(null, user.uid);
});

passport.deserializeUser(function (uid, done) {
    User.findOne({ uid: uid }, function (err, user) {
        done(err, user);
    });
});

//twitter setup (this is the twitter API client, for the twitter bot)
var Twit = require('twit')
var T = new Twit({
    consumer_key: botKey
  , consumer_secret: botSecret
  , access_token:  accessToken//this access token for VS_HQ
  , access_token_secret: accessTokenSecret
})

//These are the strings (work in progress) the twitter bot will tweet
var compromisedMessage = 'Agent @{0} you have been compromised.  Details of the perpetrator are as follows: @{1}';


//routes

//Admin debug page
//This will just provide the data regarding a user registered to the DB by searching the twitter username
//e.g. http://localhost:5000/finduser?id=wilgoddard
app.get('/finduser', function (req, res) {
    var twitterId = req.query.id;

    if (twitterId === undefined)
    {
        res.send('Provide a twitter username (id=)');
    }

    User.findOne({ username: twitterId }, function (err, user) {
        if (user) {
            res.send(user);
        } else {
            res.send('no luck... check case');
        }
    })
});

//Game event organizer page
//This is a simple GET route to handle pairing the twitter username to a unique (arbitrary) game code
//e.g. http://localhost:5000/pair?id=wilgoddard&code=34233
app.get('/pair', function (req, res) {

    var twitterId = req.query.id;
    var code = req.query.code;

    if (twitterId === undefined || code === undefined)
    {
        res.send("Please enter a twitterId (id) and gamecode (code)");
    }
    
    User.findOne({ username: twitterId }, function (err, user) {
        if (user) {
            user.gamecode = code;
            user.save(function (err) {
                if (err) { throw err; }
            });
            res.send("paired " + twitterId + " with " + code + "<br><br>" + user);
        } else {
            res.send('no luck finding user, check case');
        }
    })
});

app.get('/target', function (req, res) {

    //To be able to target a user you must be signed in. 
    if (req.user === undefined) {
        res.redirect('/');
        return;
    }

    //The unique game code of the opponent
    var code = req.query.code;

    if (code === undefined) {
        res.send("Need a code to target");
    }

    User.findOne({ gamecode: code }, function (err, user) {
        if (user) {
            if (req.user.username == user.username) {
                res.send("You cannot target yourself");
            } else {

                var status = 'Agent @' + user.username + ' you have been compromised.  Details of the perpetrator are as follows: @' + req.user.username;
                T.post('statuses/update', { status: status }, function (err, reply) {
                    
                })
                res.send(req.user.username + " targeted " + user.username + " and compromised target!");
            }
            
        } else {
            res.send('Failed to find target');
        }
    })
});

app.get('/twest', function (req, res) {

    if (req.user === undefined || req.user.username != "VS_HQ")
    {
        res.redirect('/');
        return;
    }

    var status = req.query.message;
    T.post('statuses/update', { status: status }, function (err, reply) {
        if (err) {
            res.send(err);
        } else {
            res.send("Status sent of " + status);
        }
    })
 
});

//This is the route to receive the callback from Twitter when the user authorizes the app
app.get('/auth/twitter/callback',
  passport.authenticate('twitter', {
      successRedirect: '/',
      failureRedirect: '/login'
}));

//This is the page that will handle the Twitter authentication (send off to official Twitter)
app.get('/auth/twitter', passport.authenticate('twitter'));

app.get('/logout', function (req, res) {
    req.logout();
    res.redirect('/');
});

//Home page
//if the user isn't logged in, it will redirect to our login system, which will point to twitter and then come back
//e.g. http://localhost:5000/
app.get('/', function (req, res) {

    if (req.user === undefined) {
        res.redirect('/auth/twitter');
    } else {
        if (req.user.gamecode === undefined || req.user.gamecode == null) {
            res.send("Please talk to a game organizer to receive your unique code to play!")
        } else {
            res.send(req.user.username + " is ready to play! (This should be showing the code input screen)");
        }
    }
});


var port = Number(process.env.PORT || 5000);
app.listen(port, function() {
    console.log("Listening on " + port);
});