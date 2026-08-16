const { publishDueActivities } = require('./activities');
const { scanModeration, executeDueActions } = require('./moderation');
const { validateOpenVoiceSessions } = require('./voice');
const { processWeeklyRewards } = require('./rewards');
const { cleanupTokens } = require('./access');
let started=false;
function run(label,fn){Promise.resolve().then(fn).catch(e=>console.error(`GOLEM // ${label}`,e));}
function startSchedulers(client){if(started)return;started=true;const jobs=[['VOICE',30000,()=>validateOpenVoiceSessions(client)],['PUBLICATION',30000,()=>publishDueActivities(client)],['SURVEILLANCE',60000,()=>scanModeration(client)],['ACTIONS',30000,()=>executeDueActions(client)],['RÉCOMPENSES',300000,()=>processWeeklyRewards(client)],['TOKENS',1800000,cleanupTokens]];for(const[j,ms,fn]of jobs){run(j,fn);setInterval(()=>run(j,fn),ms)}console.log('✅ GOLEM SCHEDULERS // READY');}
module.exports={startSchedulers};
