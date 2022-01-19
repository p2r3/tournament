const fs = require("fs");
const https = require("https");
const { exec } = require("child_process");
const Discord = require("discord.js");
const discordReply = require("discord-reply")
const superagent = require("superagent");
const ytdl = require('ytdl-core');

const client = new Discord.Client();

client.once("ready", () => {

  console.log("Logged in!");
  loadCache();

});

// Bot configuration, containing the main channel's ID, file names, admin IDs, etc.
// "lock" and "map" are expected to change during runtime.
const config = {
  prefix: "!lb",
  channel: "854697271480549406",
  fsBoards: "leaderboards",
  fsVideos: "videos",
  fsNicks: "nicknames",
  fsPartners: "partners",
  fsArchives: "archives",
  admin: {
    "380730068110147584": true, // p2r3
    "267331989072248833": true, // lucasskywalker
    "540707660555878420": true, // Fridge
    "378178434725052416": true, // dustyhobo
    "933251694006001744": true  // ansisg
  },
  lock: false,
  map: {
    file: "",
    name: ""
  }
};

const tokens = {
  discord: "",
  youtube: ""
}

// Defines and loads cache on startup to optimize disk usage and clean up code.
// The "database" is literally a bunch of text files in folders, human readable.
const cache = {
  boards: [],
  videos: [],
  nicks: [],
  submit: [],
  partner: [],
  archive: {
    boards: [],
    videos: []
  }
};

function loadCache() {

  for (const curr in cache) cache[curr] = [];
  cache.archive.boards = [];
  cache.archive.videos = [];

  // Loads nicknames, indexing by user ID.
  fs.readdir(config.fsNicks, function(dirErr, names) {
    if (dirErr) return console.log(dirErr);
    for (let i = 0; i < names.length; i++) {
      fs.readFile(config.fsNicks + "/" + names[i], "utf8", (err, currName) => {
        if (err) return console.log(err);
        cache.nicks[names[i]] = currName;
      });
    }
  });
  // Loads co-op partners, indexing by user ID.
  fs.readdir(config.fsPartners, function(dirErr, categories) {
    if (dirErr) return console.log(dirErr);
    for (let i = 0; i < categories.length; i++) {
      const cat = categories[i];
      cache.partner[cat] = [];
      fs.readdir(config.fsPartners + "/" + cat, function(dirErr, partners) {
        if (dirErr) return console.log(dirErr);
        for (let i = 0; i < partners.length; i++) {
          fs.readFile(config.fsPartners + "/" + cat + "/" + partners[i], "utf8", (err, currPartner) => {
            if (err) return console.log(err);
            client.users.fetch(currPartner.replace("i", "")).then((partner) => {
              cache.partner[cat][partners[i]] = partner;
            });
          });
        }
      });
    }
  });
  // Loads leaderboards for all categories.
  fs.readdir(config.fsBoards, function(dirErr, boards) {
    if (dirErr) return console.log(dirErr);
    for (let i = 0; i < boards.length; i++) {
      fs.readFile(config.fsBoards + "/" + boards[i], "utf8", (err, currBoard) => {
        if (err) return console.log(err);
        currBoard = currBoard.replace(/\r/g, "").split("\n");
        cache.boards[boards[i]] = [];
        const runs = Math.round(currBoard.length / 4);
        for (let j = 0; j < runs; j++) {
          cache.boards[boards[i]][j] = {
            id: currBoard[j * 4], // User ID
            name: currBoard[j * 4 + 1], // Nickname
            time: Number(currBoard[j * 4 + 2]), // Time in millseconds
            note: currBoard[j * 4 + 3] // Comment
          };
        }
        // Last line sets leaderboard mode (either SOLO or COOP)
        if (currBoard[currBoard.length - 1] == "COOP") cache.boards[boards[i]].coop = true;
        else cache.boards[boards[i]].coop = false;
      });
    }
  });
  // Loads an array of every submitted link.
  fs.readFile(config.fsVideos, "utf8", (err, videos) => {
    if (err) return console.log(err);
    var lines = videos.split("\n");
    for (let i = 0; i < lines.length; i++) {
      var curr = lines[i].split(" ");
      cache.videos[i] = {
        link: curr.pop(), // Last element - video link
        cat: curr.pop(), // Second to last element - category
        name: curr.join(" ") // Whatever's left over - username
      };
    }
  });
  // Loads archives of all previous weeks
  for (let week = 1; week < currWeek(); week++) {
    // Leaderboard archives
    cache.archive.boards[week] = [];
    fs.readdir(`${config.fsArchives}/${config.fsBoards}-${week+1}`, function(dirErr, boards) {
      if (dirErr) return console.log(dirErr);
      for (let i = 0; i < boards.length; i++) {
        fs.readFile(`${config.fsArchives}/${config.fsBoards}-${week+1}/${boards[i]}`, "utf8", (err, currBoard) => {
          if (err) return console.log(err);
          currBoard = currBoard.replace(/\r/g, "").split("\n");
          cache.archive.boards[week][boards[i]] = [];
          const runs = Math.round(currBoard.length / 4);
          for (let j = 0; j < runs; j++) {
            cache.archive.boards[week][boards[i]][j] = {
              id: currBoard[j * 4], // User ID
              name: currBoard[j * 4 + 1], // Nickname
              time: Number(currBoard[j * 4 + 2]), // Time in millseconds
              note: currBoard[j * 4 + 3] // Comment
            };
          }
          // Last line sets leaderboard mode (either SOLO or COOP)
          // Most likely not set for earlier weeks. Defaults to SOLO.
          if (currBoard[currBoard.length - 1] == "COOP") cache.archive.boards[week][boards[i]].coop = true;
          else cache.archive.boards[week][boards[i]].coop = false;
        });
      }
    });
    // Link archives
    cache.archive.videos[week] = [];
    fs.readFile(`${config.fsArchives}/${config.fsVideos}-${week+1}`, "utf8", (err, videos) => {
      if (err) return console.log(err);
      const lines = videos.split("\n");
      for (let i = 0; i < lines.length; i++) {
        var curr = lines[i].split(" ");
        cache.archive.videos[week][i] = {
          link: curr.pop(), // Last element - video link
          cat: curr.pop(), // Second to last element - category
          name: curr.join(" ") // Whatever's left over - username
        };
      }
    });
  }

}

// Simple functions for saving caches back into files
function saveBoard(message, cat) {

  try {
    var curr = cache.boards[cat],
      newLb = "";
    for (var i = 0; i < curr.length; i++) {
      newLb += curr[i].id + "\n";
      newLb += curr[i].name + "\n";
      newLb += curr[i].time + "\n";
      newLb += curr[i].note + "\n";
    }
    if (cache.boards[cat].coop) newLb += "COOP";
    else newLb += "SOLO";
  } catch (e) {
    replyToCommand(message, "An error occurred while saving the leaderboard data!");
    return console.log(e);
  }

  fs.writeFile(config.fsBoards + "/" + cat, newLb, "utf8", function(err) {
    if (err) {
      replyToCommand(message, "An error occurred while saving the leaderboard data!");
      return console.log(err);
    }
  });

}

function saveVideo(message, cat, link) {

  var name = getName(message.author);
  cache.videos.push({
    name: name,
    cat: cat,
    link: link
  });
  fs.appendFile(config.fsVideos, `${name} ${cat} ${link}\n`, function(err) {
    if (err) {
      replyToCommand(message, "An error occurred while saving the video!");
      return console.log(err);
    }
  });

}

function removeRun(message, cat, player) {

  for (let i = 0; i < cache.boards[cat].length; i++) {
    if (cache.boards[cat][i].id == player.id) {
      cache.boards[cat].splice(i, 1);
      saveBoard(message, cat);
      replyToCommand(message, "Run has been removed!");
      return;
    }
  }
  replyToCommand(message, "Player " + getName(player) + " doesn't have a run in this category.");

}

function editRun(message, cat, player, note) {

  for (let i = 0; i < cache.boards[cat].length; i++) {
    if (cache.boards[cat][i].id == player.id) {
      cache.boards[cat][i].note = note;
      saveBoard(message, cat);
      replyToCommand(message, "Run has been updated!");
      return;
    }
  }
  replyToCommand(message, "Player " + getName(player) + " doesn't have a run in this category.");

}

function saveNick(message) {

  fs.writeFile(config.fsNicks + "/" + message.author.id, cache.nicks[message.author.id], "utf8", function(err) {
    if (err) {
      replyToCommand(message, "An error occurred while saving your nickname!");
      return console.log(err);
    } else {
      // Updates the name in every board and saves it
      for (const curr in cache.boards) {
        for (let i = 0; i < cache.boards[curr].length; i++) {
          if (cache.boards[curr][i].id == message.author.id) {
            cache.boards[curr][i].name = cache.nicks[message.author.id];
            break;
          }
        }
        saveBoard(message, curr);
      }
      replyToCommand(message, "Your name has been changed!");
    }
  });

}

function createBoard(message, cat) {

  if (cache.boards[cat]) {
    replyToCommand(message, "Category already exists!");
    return;
  } else {
    cache.boards[cat] = [];
    cache.boards[cat].coop = false;
  }

  fs.writeFile(config.fsBoards + "/" + cat, "", "utf8", function(err) {
    if (err) {
      replyToCommand(message, "An error occurred while saving the leaderboard data!");
      return console.log(err);
    } else {
      replyToCommand(message, "Created leaderboard for category `" + cat + "`!");
    }
  });

}

function removeBoard(message, cat) {

  delete cache.boards[cat];
  fs.unlink(config.fsBoards + "/" + cat, function(err) {
    if (err) {
      replyToCommand(message, "There was an error removing the category!");
      return console.log(err);
    } else replyToCommand(message, "Deleted category `" + cat + "`!");
  });

}

// A bunch of small functions for handling specific common tasks
function replyToCommand(message, reply) {

  if (!message.guild || message.channel.id == config.channel) return message.lineReplyNoMention(reply);
  return client.channels.cache.get(config.channel).send(`<@${message.author}> ${reply}`);

}

function messageToCommand(message, reply) {

  if (!message.guild) return message.channel.send(reply);
  return client.channels.cache.get(config.channel).send(reply);

}

function getName(user) {

  if (typeof cache.nicks[user.id] === "undefined") return user.username;
  return cache.nicks[user.id];

}

function getRunLink(run, cat) {

  for (let i = cache.videos.length - 1; i >= 0; i--) {
    const vid = cache.videos[i];
    if (run.name == vid.name && cat == vid.cat) return vid.link;
  }

}

function currWeek() {

  let firstWeek = new Date(2021, 3, 4),
    thisWeek = new Date(),
    dayDiff = Math.round((thisWeek - firstWeek) / (1000 * 60 * 60 * 24)),
    weekDiff = Math.ceil(dayDiff / 7);
  return weekDiff + 1;

}

function millisToString(ms) {

  let output = "",
    min = Math.floor(ms / 60000),
    sec = ms % 60000 / 1000;

  if (min !== 0) output += min + ":";
  if (sec < 10) output += "0";
  output += sec.toFixed(3);

  return output;

}

function stringToMillis(str) {

  // Splits by every : and . equally to accont for user stupidity
  var arr = str.replace(/:/g, ".").split(".");
  var millis = NaN;

  if (arr.length === 3) {

    millis = arr.shift() * 60000; // Minutes
    millis += Number(arr.join(".")).toFixed(3) * 1000; // Seconds.milliseconds

  } else if (arr.length === 2) {

    if (str.indexOf(":") > -1) {
      millis = arr[0] * 60000; // Minutes
      millis += arr[1] * 1000; // Seconds
    } else {
      millis = Number(arr.join(".")).toFixed(3) * 1000; // Seconds.milliseconds
    }

  } else millis = arr[0] * 1000; // Now we pray that this is in seconds

  return millis;

}

// Rather huge functions for run submission and verification
function submitTime(message, runData) {

  const cat = runData.cat,
    time = runData.time,
    note = runData.note,
    lp = parseInt(note, 10),
    curr = cache.boards[cat];

  // Removes the player from the board if they're already on it
  for (let i = 0; i < curr.length; i++) {
    if (curr[i].id == message.author.id) {
      cache.boards[cat].splice(i, 1);
      break;
    }
  }
  // Removes their partner if it's co-op and they are on the board
  if (cache.boards[cat].coop) {
    for (let i = 0; i < curr.length; i++) {
      if (curr[i].id == cache.partner[cat][message.author.id].id) {
        cache.boards[cat].splice(i, 1);
        break;
      }
    }
  }

  var placement = curr.length;
  for (let i = 0; i < curr.length; i++) {
    let currLp = parseInt(curr[i].note, 10);
    if (
      ((cat == "lp" || cat == "lp-solo") && // Category is LP:
        lp < currLp || // Less portals or...
        (lp == currLp && time < curr[i].time)) || // Same portals, faster time.
      ((cat != "lp" && cat != "lp-solo") && // Category isn't LP:
        time < curr[i].time) // Faster time
    ) {
      placement = i;
      break;
    }
  }

  cache.boards[cat].splice(placement, 0, {
    id: message.author.id,
    name: getName(message.author),
    time: time,
    note: note
  });
  saveBoard(message, cat);
  client.channels.cache.get(config.channel).send("<@" + message.author + "> Your time has been added: `" + millisToString(time) + "`. Category: `" + cat + "`");
  cache.submit[message.author] = undefined;
  return;

}

function verifyDemo(message, runData) {

  var request = https.get(message.attachments.first().url, (res) => {

    var data = "";
    res.setEncoding('binary');
    res.on("data", (chunk) => {
      data += chunk;
      if (data.length >= 1064) {

        // Checks if the map name in the demo header maches the one in config
        var mapString = data.substring(536, 796).split("\x00")[0];
        if (mapString != config.map.file) {
          replyToCommand(message, "Demo is not from this week's map!\nThis will be reported to the organizers.");
          for (const adminId in config.admin) {
            try {
              client.users.fetch(adminId).then((admin) => {
                admin.send("Player `" + getName(message.author) + "` attempted to submit a run on `" + mapString + ".bsp`!");
              });
            } catch (e) {
              console.log(`${getName(message.author)} maperror ${mapString}!=${config.map.file}`);
            }
          }
          request.destroy();
          return;
        }

        // Converts the ticks in the demo header string to an integer
        var runTicks = Math.round(runData.time * 0.06);
        var ticksString = data.substring(1060, 1064),
          ticks = 0;
        for (var i = 0; i < 4; i++) ticks += ticksString.charCodeAt(i) * Math.pow(2, i * 8);

        // Checks if the submited time is accurate (allowing up to +5 ticks)
        if (ticks == 0) {
          replyToCommand(message, "The demo header is corrupted, please make sure you followed all instructions.");
          // Until I bother to implement a proper way to do this, I'll keep it commented out.
        /*
        } else if ((runTicks > ticks+7 || runTicks < ticks+2) && runData.cat != "softlock"){
          const expected = millisToString(Math.round((ticks+2) / 0.06));
          replyToCommand(message, "Demo length doesn't match your submitted time!\nExpected: `" + expected + "`");
        */
        } else {
          saveVideo(message, runData.cat, message.attachments.first().url);
          submitTime(message, runData);
        }

        request.destroy();
        return;
      }

    });

  }).on("error", (err) => {
    console.log(err);
  });

}
async function verifyVideo(message, runData) {

  try {
    var linksplit = message.content.split("youtube.com/watch?v=");
    if (linksplit.length == 1) linksplit = message.content.split("youtu.be/");
    var videoid = linksplit[1].slice(0, 11);
  } catch (e) {
    replyToCommand(message, "Failed to verify the video! Make sure you copied the link correctly.");
    return;
  }

  if (message.content.indexOf("dQw4w9WgXcQ") > -1) {
    replyToCommand(message, "Never gonna give you up,\nNever gonna let you submit an invalid run.");
    return;
  }

  try {
    const response = await superagent
      .get("https://www.googleapis.com/youtube/v3/videos")
      .query({ id: videoid })
      .query({ key: tokens.youtube })
      .query({ part: "contentDetails" });
    const duration = response.body.items[0].contentDetails.duration;

    var timeInMillis = 0;
    if (duration.indexOf("M") > -1) {
      timeInMillis += Number(duration.split("T")[1].split("M")[0]) * 60 * 1000;
      timeInMillis += Number(duration.split("M")[1].split("S")[0]) * 1000;
    } else {
      timeInMillis += Number(duration.split("T")[1].split("S")[0]) * 1000;
    }

    if (Math.abs(runData.time - timeInMillis) > 5000) {
      replyToCommand(message, "Video length doesn't match your submited time.");
      return;
    }
    saveVideo(message, runData.cat, message.content);
    submitTime(message, cache.submit[message.author]);
  } catch (e) {
    replyToCommand(message, "Failed to verify the video.");
    return console.log(e);
  }

}

// Functions for managing submitted demos and videos
function downloadRuns(message, msg, youtube) {

  let downloaded = 0,
    expected = 0,
    ytvids = [];
  message.channel.send("Downloading (0%)").then(function(dlmsg) {
    for (const curr in cache.boards) {
      fs.mkdirSync("downloaded/" + curr, { recursive: true });
      for (let i = 0; i < cache.boards[curr].length; i++) {

        const run = cache.boards[curr][i];
        const filename = `downloaded/${curr}/${run.name.replace(/ /g, "_")}-${curr}-${millisToString(run.time).replace(/\./g,"_").replace(/\:/g,"_")}`;
        const link = getRunLink(run, curr);

        if (link.endsWith(".dem") || link.endsWith(".mp4")) {
          expected++;
          const file = fs.createWriteStream(filename + ".dem");
          const request = https.get(link, function(response) {
            response.pipe(file);
            response.on("end", () => {
              if (++downloaded == expected) sendRuns(dlmsg, ytvids);
              dlmsg.edit(`Downloading (${Math.round(downloaded/expected*100)}%)`);
            });
          });
        } else if (link.indexOf("youtu") > -1) {
          if (youtube) {
            expected += 2;
            ytvids.push(filename);
            const vidfile = fs.createWriteStream(filename + "-vid.mp4");
            const audfile = fs.createWriteStream(filename + "-aud.mp4");
            let video = ytdl(link, { quality: "highestvideo", dlChunkSize: "5MB" }).on("end", () => {
              if (++downloaded == expected) sendRuns(dlmsg, ytvids);
              dlmsg.edit(`Downloading (${Math.round(downloaded/expected*100)}%)`);
            }).pipe(vidfile);
            let audio = ytdl(link, { quality: "highestaudio", dlChunkSize: "5MB" }).on("end", () => {
              if (++downloaded == expected) sendRuns(dlmsg, ytvids);
              dlmsg.edit(`Downloading (${Math.round(downloaded/expected*100)}%)`);
            }).pipe(audfile);
          } else {
            fs.appendFile("downloaded/yt-links.txt", run.name + " | " + curr + " | " + link + "\n", function(err) {
              if (err) {
                deleteRuns();
                return message.channel.send("Failed to save YouTube links!");
              }
            });
          }
        }

      }
    }
  });

}

function sendRuns(message, ytvids) {

  setTimeout(function() {
    if (ytvids.length > 0) message.edit("Combining audio/video...");
    else {
      message.edit("Compressing...");
      const zip = exec("7z a -r runs.7z downloaded/*");
      zip.on("close", () => {
        fs.rename("runs.7z", "/var/www/html/runs.7z", function(err) {
          if (err) return message.channel.send("Failed to move archive file!");
          message.channel.send("Download finished: https://p2r3.com/runs.7z\nRuns will be deleted from the server in 5 minutes!");
          message.delete();
          setTimeout(deleteRuns, 300000);
        });
      });
      return;
    }
    let expected = ytvids.length,
      combined = 0;
    for (let i = 0; i < expected; i++) {
      const ffmpeg = exec(`ffmpeg -i ${ytvids[i]}-vid.mp4 -i ${ytvids[i]}-aud.mp4 -c copy -map 0:v:0 -map 1:a:0 ${ytvids[i]}.mp4`);
      ffmpeg.on("close", () => {
        if (++combined == expected) {
          message.edit("Cleaning up...");
          for (let j = 0; j < expected; j++) {
            fs.unlinkSync(ytvids[j] + "-vid.mp4");
            fs.unlinkSync(ytvids[j] + "-aud.mp4");
          }
          message.edit("Compressing...");
          const zip = exec("7z a -r runs.7z downloaded/*");
          zip.on("close", () => {
            fs.rename("runs.7z", "/var/www/html/runs.7z", function(err) {
              if (err) return message.channel.send("Failed to move archive file!");
              message.channel.send("Download finished: https://p2r3.com/runs.7z\nRuns will be deleted from the server in 5 minutes!");
              message.delete();
              setTimeout(deleteRuns, 300000);
            });
          });
        }
      });
    }
  }, 1000);

}

function deleteRuns(message) {

  fs.unlink("/var/www/html/runs.7z", (err) => {
    if (err) {
      if (message) message.channel.send("Failed to delete demos from the server. They've probably been deleted already.");
      console.log(err);
    }
    if (message) message.channel.send("Deleted zipfile");
  });
  fs.rmdir("downloaded", { recursive: true }, (err) => {
    if (err) {
      if (message) message.channel.send("Failed to delete demos from the server. This is a security risk.");
      console.log(err);
    }
    if (message) message.channel.send("Deleted directory");
    fs.mkdir("downloaded", (err) => {
      if (err) {
        if (message) message.channel.send("Failed to create directory for future downloads. Report this to p2r3.");
        console.log(err);
      }
      if (message) message.channel.send("Created directory");
    });
  });

}

function categoryName(cat) {

  switch (cat) {
    case "main":
      return "main category";
    case "lp":
      return "least portals";
    case "ppnf":
      return "portal placement never fail";
    case "sla":
      return "save load abuse";
    case "oob":
      return "out of bounds";
    case "main-solo":
      return "solo co-op";
    case "ppnf-solo":
      return "portal placement never fail (solo)";
    case "0friction":
      return "zero friction";
    case "lowgrav":
      return "low gravity";
    case "tas":
      return "tool assisted speedrun";
    case "softlock":
    case "noclip":
      return cat + "%";
  }
  return cat;

}

function exportRuns(message) {

  // Calculates preferred category display order
  // First, remove the unnecessary categories from an already sorted list
  var order = ["main", "main-solo", "ppnf", "ppnf-solo", "softlock", "0friction", "lowgrav", "jumpless", "sla", "oob", "lp", "lp-solo", "tas", "segmented", "meme"];
  for (let i = 0; i < order.length; i++) {
    let found = false;
    for (const curr in cache.boards) {
      if (curr == order[i]) {
        found = true;
        break;
      }
    }
    if (!found) {
      order.splice(i, 1);
      i--;
    }
  }
  // Same thing but in reverse, add categories that weren't in the list
  for (const curr in cache.boards) {
    let found = false;
    for (let i = 0; i < order.length; i++) {
      if (order[i] == curr) {
        found = true;
        break;
      }
    }
    if (!found) order.push(curr);
  }
  // Global configuration
  var output =
    `{
  "config": {
    "index": ["${order.join('", "')}"],
    "week": "week ${currWeek()}",
    "map": "${config.map.name}",
    "style": "short",
    "broll": "broll.mp4"
  },
  "categories": {`;

  // Appends an object for every category in order
  for (let i = 0; i < order.length; i++) {
    const curr = cache.boards[order[i]];

    // Calculates time variation
    var slowest = curr[0].time,
      fastest = curr[0].time;
    for (let j = 0; j < curr.length; j++) {
      if (curr[j].time > slowest) slowest = curr[j].time;
      if (curr[j].time < fastest) fastest = curr[j].time;
    }
    let variation = Math.round((slowest - fastest) / 1000) + " second difference";
    // If needed, calculates portal variation
    if (order[i] == "lp" || order[i] == "lp-solo") {
      let lp = curr[0].note.split(" ")[0],
        mp = curr[curr.length - 1].note.split(" ")[0];
      variation += "<br>" + (mp - lp) + " portal difference";
    }

    var catname = categoryName(order[i]);

    // Sort board data to be compatible with the stream UI
    var players = [],
      times = [],
      notes = [],
      videos = [];
    for (let j = 0; j < curr.length; j++) {
      players[j] = curr[j].name;
      if (order[i] != "lp" && order[i] != "lp-solo") times[j] = millisToString(curr[j].time);
      else times[j] = millisToString(curr[j].time) + "<br>portals: " + curr[j].note.split(" ")[0];
      notes[j] = curr[j].note;
      videos[j] = `${curr[j].name.replace(/ /g, "_")}-${order[i]}-${millisToString(curr[j].time).replace(/\./g, "_").replace(/\:/g, "_")}.dem.mp4`;
    }

    output += `
    "${order[i]}": {
      "coop": ${curr.coop},
      "category": "${catname}",
      "times": "${curr.length} runs submitted",
      "variation": "${variation}",
      "players": ["${players.join('", "')}"],
      "time": ["${times.join('", "')}"],
      "comments": ["${notes.join('", "')}"],
      "videos": ["${videos.join('", "')}"]
    },`;

  }
  output = output.slice(0, -1) + "\n  }\n}";

  // Send output as a file to work around message size limits
  fs.writeFile("export-tmp", output, "utf8", function(err) {
    if (err) {
      replyToCommand(message, "Failed to save exported data.");
      return console.log(err);
    }
    let attachment = new Discord.MessageAttachment("export-tmp", "config.json");
    message.channel.send("JSON data for Week " + currWeek(), attachment).then(function() {
      fs.unlink("export-tmp", function(err) { if (err) console.log(err); });
    });
  });

}

function exportIntro(message) {

  let players = [];
  for (const curr in cache.boards) {
    const runs = cache.boards[curr];
    for (let i = 0; i < runs.length; i++) {
      if (typeof players[runs[i].id] === "undefined") players[runs[i].id] = true;
    }
  }

  const output = `
\`week ${currWeek()}
${Object.keys(players).length} runners
${Object.keys(cache.boards).length} categories\``;
  return replyToCommand(message, output);

}

// Fat function for creating leaderboard embeds
function displayLeaderboard(message, msg) {

  // Tries to get the category name from the command.
  // If it's not specified, defaults to "main"
  try {
    var cat = msg.split(" ")[2].toLowerCase();
  } catch (e) {
    var cat = "main";
  } finally {
    var runs = cache.boards[cat];
  }

  // Checks if the category is defined in the cache.
  // If not, tries to suggest a category that's one letter off.
  if (typeof runs == "undefined") {
    for (const curr in cache.boards) {
      var charSum = 0;
      for (let i = 0; i < cat.length; i++) charSum += cat.charCodeAt(i);
      for (let i = 0; i < curr.length; i++) charSum -= curr.charCodeAt(i);
      if (Math.abs(charSum) == 1) {
        replyToCommand(message, "Did you mean `!LB get " + curr + "`?");
        return;
      }
    }
    // If above hasn't returned, the category doesn't exist
    // (or there was a bigger typo, not my fault)
    return replyToCommand(message, "The specified category doesn't exist!");
  }

  // Checks if the category has no elements
  if (runs.length === 0) {
    replyToCommand(message, "This category is empty!");
    return;
  }

  // Finds slowest and fastest time.
  // Because of exceptions like LP, this doesn't just get the first/last run.
  var slowest = runs[0].time,
    fastest = runs[0].time;
  for (let i = 0; i < runs.length; i++) {
    if (runs[i].time > slowest) slowest = runs[i].time;
    if (runs[i].time < fastest) fastest = runs[i].time;
  }

  // This is where we actually generate the embed(s).
  // It's defined before the loop so the board can get split up if needed.
  const embed = {
    color: 0xfaa81a,
    title: "Leaderboard for category \"" + cat + "\"",
    fields: [],
    footer: {
      text: "Week " + currWeek() + " / " + runs.length + " runs / " + Math.round((slowest - fastest) / 1000) + " second difference"
    }
  };

  var offset = 1; // Offset for leaderboard ties.
  for (let i = 0; i < runs.length; i++) {

    // Tied runs just decrement an offset used for displaying the placement.
    if (i > 0 && runs[i].time == runs[i - 1].time) offset--;

    // On a co-op leaderboard, the comment includes the partner's username.
    if (runs.coop) {
      var partnername = runs[i].note.split("~COOP:");
      partnername = partnername[partnername.length - 1];
      var displayname = runs[i].name + " / " + partnername;
      var note = runs[i].note.substring(0, runs[i].note.indexOf("~COOP:"));
    } else {
      var displayname = runs[i].name;
      var note = runs[i].note;
    }

    // Defines values for the run's respective embed field.
    // fieldName is the player's placement and username,
    // fieldValue is their time, and optionally their comment.
    let fieldName = "#" + (i + offset) + " " + displayname;
    let fieldValue = "`" + millisToString(runs[i].time) + "`";
    if (note.length > 0) fieldValue += " - *\"" + note.replace(/\*/g, "\\*") + "\"*";
    embed.fields.push({
      name: fieldName,
      value: fieldValue
    });

    // In case the embed exceeds the 25 field limit, it gets split up.
    // The footer is removed for every embed until the last one.
    // The title is removed for every embed after the first one.
    // Only the first embed is a reply, the rest are simple messages.
    if ((i + 1) % 25 === 0 && i < runs.length) {
      let tmp = embed.footer;
      embed.footer = {};
      if (i === 24 && message.guild === null) replyToCommand(message, { embed: embed });
      else messageToCommand(message, { embed: embed });
      embed.title = "";
      embed.fields = [];
      embed.footer = tmp;
    }

  }
  // Send the final embed as a reply. (Or not, if there was an embed before it)
  if (runs.length <= 25 && message.guild === null) replyToCommand(message, { embed: embed });
  else messageToCommand(message, { embed: embed });

}

// Fetches old leaderboards by reading the filesystem directly.
// This is almost a copy of the displayLeaderboard function.
function displayArchive(message, msg) {

  // Tries to get the category name and week number from the command.
  try {
    var week = Number(msg.split(" ")[2]);
    var cat = msg.split(" ")[3];
    if (msg.split(" ")[4] == "links") var links = true;
    else var links = false;
    if (isNaN(week)) throw 0;
    if (typeof cat != "undefined") cat = cat.toLowerCase();
    else cat = "list";
  } catch (e) {
    return replyToCommand(message, "Command usage: `!LB archive <week> <category> [links]`");
  }

  // Checks if the user is stupid and specifies this week
  if (week == currWeek()) {
    // Checks if they're doubly stupid and asked for a list too
    if (cat == "list") {
      return replyToCommand(message, "Available categories: `" + Object.keys(cache.boards).join("`, `") + "`");
    } else {
      msg = "!LB get " + cat;
      return displayLeaderboard(message, msg);
    }
  }
  // Checks if they're trying to be annoying by specifying a week in the future
  if (week > currWeek()) {
    return replyToCommand(message, "This week is in the future!");
  }
  // Checks if the user just wants a list of the categories
  if (cat == "list") {
    return replyToCommand(message, `Week ${week} categories: \`${Object.keys(cache.archive.boards[week]).join("`, `")}\``);
  }

  var runs = cache.archive.boards[week][cat];
  // The rest is almost identical to displayLeaderboard

  // Checks if the category exists
  if (typeof runs === "undefined") return replyToCommand(message, "This category didn't exist!");
  // Checks if the category has no elements
  if (runs.length === 0) return replyToCommand(message, "This category was empty!");

  // Finds slowest and fastest time.
  // Because of exceptions like LP, this doesn't just get the first/last run.
  var slowest = runs[0].time,
    fastest = runs[0].time;
  for (let i = 0; i < runs.length; i++) {
    if (runs[i].time > slowest) slowest = runs[i].time;
    if (runs[i].time < fastest) fastest = runs[i].time;
  }

  // This is where we actually generate the embed(s).
  // It's defined before the loop so the board can get split up if needed.
  const embed = {
    color: 0x00ff7c,
    title: "Archive for category \"" + cat + "\"",
    fields: [],
    footer: {
      text: "Week " + week + " / " + runs.length + " runs / " + Math.round((slowest - fastest) / 1000) + " second difference"
    }
  };

  var offset = 1; // Offset for leaderboard ties.
  for (let i = 0; i < runs.length; i++) {

    // Tied runs just decrement an offset used for displaying the placement.
    if (i > 0 && runs[i].time == runs[i - 1].time) offset--;

    // On a co-op leaderboard, the comment includes the partner's username.
    if (runs.coop) {
      var partnername = runs[i].note.split("~COOP:");
      partnername = partnername[partnername.length - 1];
      var displayname = runs[i].name + " / " + partnername;
      runs[i].note = runs[i].note.substring(0, runs[i].note.indexOf("~COOP:"));
    } else var displayname = runs[i].name;

    // Defines values for the run's respective embed field.
    // fieldName is the player's placement and username,
    // fieldValue is their time, and optionally their comment.
    // In the case of the archives, it may also provide links.
    let fieldName = "#" + (i + offset) + " " + displayname;
    let fieldValue = "`" + millisToString(runs[i].time) + "`";
    if (links) {
      const links = cache.archive.videos[week];
      for (let j = links.length - 1; j >= 0; j--) {
        if (links[j].cat == cat && links[j].name == runs[i].name) {
          fieldValue += ` - ${links[j].link}`;
          break;
        }
      }
    } else if (runs[i].note.length > 0) fieldValue += ` - *${runs[i].note.replace(/\*/g,"\\*")}"*`;
    embed.fields.push({
      name: fieldName,
      value: fieldValue
    });

    // In case the embed exceeds the 25 field limit, it gets split up.
    // The footer is removed for every embed until the last one.
    // The title is removed for every embed after the first one.
    // Only the first embed is a reply, the rest are simple messages.
    if ((i + 1) % 25 === 0 && i < runs.length) {
      let tmp = embed.footer;
      embed.footer = {};
      if (i === 24 && message.guild === null) replyToCommand(message, { embed: embed });
      else messageToCommand(message, { embed: embed });
      embed.title = "";
      embed.fields = [];
      embed.footer = tmp;
    }

  }
  // Send the final embed as a reply. (Or not, if there was an embed before it)
  if (runs.length <= 25 && message.guild === null) replyToCommand(message, { embed: embed });
  else messageToCommand(message, { embed: embed });

}

// Handling user commands
client.on("message", (message) => {

  if (message.author.bot) return;

  // Checks if the message is a valid, expected video submission.
  if (message.guild === null && cache.submit[message.author]) {
    if (message.attachments.size > 0) {
      const url = message.attachments.first().url;
      if (url.toLowerCase().endsWith(".dem")) {
        verifyDemo(message, cache.submit[message.author]);
      } else if (url.toLowerCase().endsWith(".mp4") || url.toLowerCase().endsWith(".flv")) {
        saveVideo(message, cache.submit[message.author].cat, url);
        submitTime(message, cache.submit[message.author]);
      } else {
        replyToCommand(message, "Please attach a valid demo file, video file, or YouTube link.");
        return;
      }
    } else if (message.content.indexOf("youtu") > -1) {
      verifyVideo(message, cache.submit[message.author]);
    }
  }

  if (!message.content.toLowerCase().startsWith(config.prefix)) return;

  if (message.content.indexOf("\n") > -1) {
    replyToCommand(message, "Please keep the command on one line!");
    return;
  }

  var msg = message.content;
  while (msg.indexOf("  ") > -1) msg = msg.replace("  ", " ");
  var args = msg.split(" ");

  try {
    var command = args[1].toLowerCase();
  } catch (e) {
    var command = "get";
  }

  switch (command) {
    case "get":

      displayLeaderboard(message, msg);
      break;
    case "archive":

      displayArchive(message, msg);
      break;
    case "add":

      if (config.lock) return replyToCommand(message, "The leaderboard is locked, runs cannot be added.");
      try {
        var cat = args[2].toLowerCase().replace(/\//g, "");
        var time = stringToMillis(args[3]);
      } catch (e) {
        if (cat == "lp") return replyToCommand(message, "Command usage: `!LB add <category> <time> <portals> [comment]`");
        else return replyToCommand(message, "Command usage: `!LB add <category> <time> [comment]`");
      }
      if (cache.boards[cat].coop && typeof cache.partner[cat][message.author.id] == "undefined") {
        return replyToCommand(message, "You cannot submit a time without a partner!\nUse `!LB team <@partner>` to send an invite.");
      }
      if (cat == "lp") {
        var portals = parseFloat(args[4].replace(/:/g, "."), 10);
        if (isNaN(portals)) return replyToCommand(message, "Please specify your portal count right after the time.");
        if (!Number.isInteger(portals) || portals > time / 0.2) return replyToCommand(message, "Command usage: `!LB add <category> <time> <portals> [comment]`");
      }

      try {
        var comment = "";
        for (var i = 4; i < args.length; i++) {
          if (i != 4) comment += " ";
          comment += args[i];
        }
      } catch (e) {
        var comment = "";
      }
      if (cache.boards[cat].coop) {
        comment += "~COOP:" + getName(cache.partner[cat][message.author.id]);
      }

      try {
        comment = comment.replace(/`/g, "").replace(/https:\/\//g, "").replace(/http:\/\//g, "");
        if (comment.length > 200) {
          replyToCommand(message, "Please keep your comment under 180 characters!");
          return;
        }
        if (comment.indexOf("<@") > -1 && comment.indexOf(">") > -1) {
          replyToCommand(message, "It looks like you're trying to @mention someone in your comment. Don't do that.");
          return;
        }
      } catch (e) {
        console.log(e);
        replyToCommand(message, "An error occurred while checking your comment. Please don't overuse special characters.");
        return;
      }

      if (isNaN(time)) {
        replyToCommand(message, "Invalid time format!");
        return;
      }
      if (!cache.boards[cat]) {
        replyToCommand(message, "The specified category doesn't exist!");
        return;
      }

      message.author.send("To add your time to the leaderboard, please send a demo or video of your run here.\nIf you want to cancel the submission, type `!LB cancel`");

      cache.submit[message.author] = {
        cat: cat,
        time: time,
        note: comment
      };
      break;
    case "cancel":

      if (message.guild === null && cache.submit[message.author] !== undefined) {
        cache.submit[message.author] = undefined;
        replyToCommand(message, "Submission cancelled!");
      }
      break;
    case "list":
    case "categories":
    case "cats":

      replyToCommand(message, `Available categories: \`${Object.keys(cache.boards).join("`, `")}\``);
      break;
    case "deadline":
    case "dl":

      const diff = Date.now() / 1000 - 302400;
      const weektime = diff % 604800;

      if (weektime <= 554400) replyToCommand(message, "Deadline is <t:" + (diff - weektime + 900000) + ":R>");
      else replyToCommand(message, "Deadline was <t:" + (diff - weektime + 900000) + ":R>, stream is <t:" + (diff - weektime + 910800) + ":R>");
      break;
    case "removeself":

      if (config.lock) {
        replyToCommand(message, "The leaderboard is locked, runs cannot be removed.");
        return;
      }
      if (args.length > 3) {
        replyToCommand(message, "Command usage: `!LB removeself <category>`");
      }
      try {
        var cat = args[2].toLowerCase().replace(/\//g, "");
      } catch (e) {
        replyToCommand(message, "Command usage: `!LB removeself <category>`");
        return;
      }
      if (!cache.boards[cat]) {
        replyToCommand(message, "The specified category doesn't exist!");
        return;
      }

      removeRun(message, cat, message.author);
      break;
    case "edit":

      if (config.lock) {
        replyToCommand(message, "The leaderboard is locked, runs cannot be edited.");
        return;
      }
      try {
        var cat = args[2].toLowerCase();
      } catch (e) {
        replyToCommand(message, "Command usage: `!LB edit <category> [comment]`");
        return;
      }
      if (!cache.boards[cat]) {
        replyToCommand(message, "The specified category doesn't exist!");
        return;
      }
      if (cat == "lp") {
        var portals = parseFloat(args[3].replace(/:/g, "."), 10);
        if (isNaN(portals)) return replyToCommand(message, "Please specify your portal count right after the time.");
        if (!Number.isInteger(portals) || portals > time / 0.2) return replyToCommand(message, "Command usage: `!LB edit LP <portals> [comment]`");
      }
      var note = "";
      if (args.length > 3) note = msg.substring(10 + cat.length);

      editRun(message, cat, message.author, note);
      break;
    case "nick":

      if (args.length < 3) {
        replyToCommand(message, "Command usage: `!LB nick <nickname>`");
        return;
      }

      var nick = msg.substring(9, msg.length).replace(/`/g, "").replace(/@/g, "").replace(/\//g, "").replace(/\\/g, "");
      if (nick.length < 2) {
        replyToCommand(message, "Nickname too short!");
        return;
      }
      if (nick.length > 20) {
        replyToCommand(message, "Nickname cannot be longer than 20 characters!");
        return;
      }

      cache.nicks[message.author.id] = nick;
      saveNick(message);
      break;
    case "help":

      var output = `Here's a list of possible commands:
\`!LB add <category> <time> [comment]\` - Add your time to the leaderboard
\`!LB get <category>\` - See the leaderboard for a category
\`!LB list\` - List all available categories
\`!LB nick <nickname>\` - Change how your name shows up on the leaderboard
\`!LB removeself <category>\` - Remove your run from the leaderboard
\`!LB edit <category> [comment]\` - Change the comment of your run
\`!LB deadline\` - See how much time you have to submit runs
\`!LB team <category> <@partner>\` - Invite a Co-op partner
\`!LB archive <week> <category> [links]\` - See leaderboards of past weeks
\`!LB help\` - Display this help message`;
      if (config.admin[message.author.id]) output += `
\`!LB create <category>\` - Create a new category
\`!LB remove <category>\` - Delete a leaderboard (be careful!)
\`!LB removeplayer <category> <@user>\` - Remove a player from the leaderboad
\`!LB export\` - Export the leaderboard data to JSON (for stream UI)
\`!LB mode <category> <sp/coop>\` - Set leaderboard mode
\`!LB recache\` - Rebuild leaderboard, player and archive caches`;
      replyToCommand(message, output);
      break;
    case "create":

      if (config.admin[message.author.id]) {

        if (args.length > 3) {
          replyToCommand(message, "Category names cannot contain spaces.");
        }

        try {
          var cat = args[2].toLowerCase().replace(/\//g, "");
        } catch (e) {
          replyToCommand(message, "Command usage: `!LB create <category>`");
          return;
        }

        createBoard(message, cat);

      } else {
        replyToCommand(message, "Insufficient permissions!");
        return;
      }
      break;
    case "remove":
    case "delete":

      if (config.admin[message.author.id]) {

        if (args.length > 3) {
          replyToCommand(message, "Category names cannot contain spaces.");
        }

        try {
          var cat = args[2].toLowerCase().replace(/\//g, "");
        } catch (e) {
          replyToCommand(message, "Command usage: `!LB remove <category>`");
          return;
        }

        removeBoard(message, cat);

      } else {
        replyToCommand(message, "Insufficient permissions!");
        return;
      }
      break;
    case "removeplayer":

      if (config.admin[message.author.id]) {

        if (args.length > 4) {
          replyToCommand(message, "Command usage: `!LB removeself <category>`");
        }
        if (!cache.boards[cat]) {
          replyToCommand(message, "The specified category doesn't exist!");
          return;
        }

        try {
          var cat = args[2].toLowerCase().replace(/\//g, "");
          var usr = args[3].toLowerCase().split("<@!")[1].split(">")[0];
        } catch (e) {
          replyToCommand(message, "Command usage: `!LB removeplayer <category> <@user>`");
          return;
        }

        removeRun(message, cat, message.author.id);

      } else {
        replyToCommand(message, "Insufficient permissions!");
        return;
      }
      break;
    case "export":

      if (!config.admin[message.author.id]) return replyToCommand("Insufficient permissions!");
      if (message.guild !== null) return replyToCommand("This command only works in DMs!");
      exportRuns(message);
      exportIntro(message);
      break;
    case "lock":

      if (!config.admin[message.author.id]) return replyToCommand(message, "Insufficient permissions!");
      if (config.lock = !config.lock) replyToCommand(message, "Leaderboard locked!");
      else replyToCommand(message, "Leaderboard unlocked!");
      break;
    case "download-runs":

      if (!config.admin[message.author.id]) return replyToCommand(message, "Insufficient permissions!");
      if (message.guild !== null) return replyToCommand(message, "This command only works in DMs!");
      downloadRuns(message, msg, true);
      break;
    case "download-demos":

      if (!config.admin[message.author.id]) return replyToCommand(message, "Insufficient permissions!");
      if (message.guild !== null) return replyToCommand(message, "This command only works in DMs!");
      downloadRuns(message, msg, false);
      break;
    case "delete-runs":
    case "delete-demos":

      if (!config.admin[message.author.id]) return replyToCommand(message, "Insufficient permissions!");
      if (message.guild !== null) return replyToCommand(message, "This command only works in DMs!");
      deleteRuns(message);
      break;
    case "reset":

      if (!config.admin[message.author.id]) return replyToCommand(message, "Insufficient permissions!");
      if (message.guild !== null) return replyToCommand(message, "This command only works in DMs!");

      var newCats = args.slice(2);

      // Backs up current leaderboards
      try {
        const week = currWeek();
        fs.rename(config.fsBoards, `${config.fsArchives}/${config.fsBoards}-${week}`, function(err) { if (err) throw 0; });
        fs.rename(config.fsVideos, `${config.fsArchives}/${config.fsVideos}-${week}`, function(err) { if (err) throw 0; });
        fs.rename(config.fsPartners, `${config.fsArchives}/${config.fsPartners}-${week}`, function(err) { if (err) throw 0; });
      } catch (e) {
        replyToCommand(message, "Failed to back up data.");
        return console.log(e);
      }

      fs.mkdir(config.fsBoards, function(err) {
        if (err) {
          replyToCommand(message, "Failed to create leaderboard directory.");
          return console.log(err);
        }
        for (let i = 0; i < newCats.length; i++) {
          fs.writeFile(config.fsBoards + "/" + newCats[i].toLowerCase(), "", "utf8", function(err) {
            if (err) {
              replyToCommand(message, "An error occurred while creating `" + newCats[i] + "` category!");
              return console.log(err);
            }
            // Reloads the cache when done creating categories
            if (i == newCats.length - 1) loadCache();
          });
        }
      });
      fs.mkdir(config.fsPartners, (err) => {
        if (err) {
          replyToCommand(message, "Failed to create partners directory.");
          return console.log(err);
        }
      });
      break;
    case "map":

      if (!config.admin[message.author.id]) return replyToCommand(message, "Insufficient permissions!");
      if (message.guild !== null) return replyToCommand(message, "This command only works in DMs!");

      if (args.length < 4) return replyToCommand(message, "Command usage: `!LB map <filename> <displayname>`");
      try {
        if (args[2].endsWith(".bsp")) config.map.file = args[2].substring(0, args[2].length - 4);
        else config.map.file = args[2];
        config.map.name = msg.substring(9 + args[2].length);
      } catch (e) {
        return replyToCommand(message, "Failed to parse map information!");
      }
      replyToCommand(message, "Updated map information!");

      break;
    case "introduce":

      if (config.admin[message.author.id]) {
        // Why is indenting template literals so dumb
        var output = `Hi, I'm a leaderboard bot for PortalRunner's weekly tournaments!
Here's a list of things I can do:

\`!LB add <category> <time> [comment]\` - Add your time to the leaderboard
\`!LB get <category>\` - See the leaderboard for a category
\`!LB list\` - List all available categories
\`!LB removeself <category>\` - Remove your run from the leaderboard
\`!LB edit <category> [comment]\` - Change the comment of your run
\`!LB team <category> <@partner>\` - Invite a Co-op partner
\`!LB nick <nickname>\` - Change how your name shows up on the leaderboard
\`!LB deadline\` - See how much time you have to submit runs
\`!LB archive <week> <category> [links]\` - See leaderboards of past weeks
\`!LB help\` - Display this help message

If you run into any issues, don't be afraid to ask help from a moderator. Robots aren't always perfect.`;
        client.channels.cache.get(config.channel).send(output);
      }
      break;
    case "mode":

      if (config.admin[message.author.id]) {
        try {
          var cat = args[2].toLowerCase();
          if (!cache.boards[cat]) return replyToCommand(message, "The specified category doesn't exist!");
          if (args[3].toLowerCase() == "coop") cache.boards[cat].coop = true;
          if (args[3].toLowerCase() == "solo") cache.boards[cat].coop = false;
          replyToCommand(message, "Switched leaderboard to `" + args[3] + "` mode!");
        } catch (e) {
          return replyToCommand(message, "Command usage: `!LB mode <category> <solo/coop>`");
        }
      } else replyToCommand(message, "Insufficient permissions!");
      break;
    case "team":
    case "invite":
    case "accept":

      try {
        var partner = message.mentions.users.first();
        if (typeof partner == "undefined") throw 0;
        var cat = args[2].toLowerCase();
      } catch (e) {
        replyToCommand(message, "Command usage: `!LB invite <category> <@partner>`");
        return;
      }
      if (!cache.boards[cat]) return replyToCommand(message, "The specified category doesn't exist!");
      if (!cache.boards[cat].coop) return replyToCommand(message, "This is not a co-op category!");
      if (typeof cache.partner[cat][message.author.id] !== "undefined") return replyToCommand(message, "You already have a partner!");
      if (partner == message.author) return replyToCommand(message, "You cannot invite yourself!");
      if (partner.id == "854461353829204020" || partner.id == "925145694069731338") return replyToCommand(message, "You cannot invite a bot!");

      fs.access(`${config.fsPartners}/${cat}`, function(err) {
        if (err) {
          fs.mkdir(`${config.fsPartners}/${cat}`, function(mkdirErr) {
            if (mkdirErr) {
              replyToCommand(message, "An error occurred while setting up the co-op category!");
              return console.log(mkdirErr);
            }
          });
        }
      });

      fs.readFile(`${config.fsPartners}/${cat}/${partner.id}`, "utf8", function(err, team) {
        if (err) {
          fs.writeFile(`${config.fsPartners}/${cat}/${message.author.id}`, partner.id + "i", "utf8", function(err) {
            if (err) {
              replyToCommand(message, "An error occurred while saving your invite!");
              return console.log(err);
            }
            replyToCommand(message, "Invite sent! Tell your partner to invite you back.");
          });
        } else if (team == message.author.id + "i") {
          fs.writeFile(`${config.fsPartners}/${cat}/${message.author.id}`, partner.id, "utf8", function(err) {
            if (err) return replyToCommand(message, "An error occurred while saving your partner!");
            fs.writeFile(`${config.fsPartners}/${cat}/${partner.id}`, message.author.id, "utf8", function(err) {
              if (err) return replyToCommand(message, "An error occurred while saving your partner!");
              cache.partner[cat][message.author.id] = partner;
              cache.partner[cat][partner.id] = message.author;
              client.channels.cache.get(config.channel).send(`Created team - <@${message.author.id}> and <@${partner.id}>!`);
            });
          });
        } else {
          replyToCommand(message, "The player you invited already has a partner in this category.");
          return;
        }
      });

      break;
    case "cancel-invite":

      try {
        var cat = args[2].toLowerCase();
      } catch (e) {
        return replyToCommand(message, "Command usage: `!LB cancel-invite <category>`");
      }

      fs.readFile(`${config.fsPartners}/${cat}/${message.author.id}`, "utf8", function(err, team) {
        if (!err && team[team.length - 1] == "i") {
          fs.unlink(`${config.fsPartners}/${cat}/${message.author.id}`, function(delerr) {
            if (delerr) return replyToCommand(message, "Failed to cancel invite!");
            return replyToCommand(message, "Invite cancelled!");
          });
        } else {
          replyToCommand(message, "You don't have an active invite in this category.");
          return;
        }
      });
      break;
    case "recache":

      if (!config.admin[message.author.id]) return replyToCommand(message, "Insufficient permissions!");
      // For manually rebuilding the cache during runtime
      loadCache();
      break;
    default:

      fs.readdir(config.fsBoards, function(err, items) {

        if (err) {
          replyToCommand(message, "Command `" + command + "` not recognized!");
          return console.log(err);
        }

        try {
          for (var i = 0; i < items.length; i++) {
            if (command == items[i]) {
              command = "get";
              displayLeaderboard(message, "!lb get " + items[i]);
              return;
            }
          }
          for (var i = 0; i < items.length; i++) {
            var comNumSum = 0;
            var catNumSum = 0;
            for (var j = 0; j < command.length; j++) comNumSum += command.charCodeAt(j);
            for (var j = 0; j < items[i].length; j++) catNumSum += items[i].charCodeAt(j);
            if (Math.abs(comNumSum - catNumSum) == 1) {
              replyToCommand(message, "Did you mean `!LB get " + items[i] + "`?");
              return;
            }
          }
        } catch (e) {
          console.log(e);
        }
        replyToCommand(message, "Command `" + command + "` not recognized!");

      });
  }

});

client.login(tokens.discord);
