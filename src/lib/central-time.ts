const zone = 'America/Chicago';
const wallTime = (instant:number) => Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(instant).map(p=>[p.type,p.value]));
/** Convert an explicit Central wall clock; reject DST gaps and ambiguous folds. */
export function centralInstant(value:string):string {
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw Error('Enter a valid Central date and time.');
 const nominal=Date.parse(value+'Z');const matches=[];
 for(const offset of [5,6]){const candidate=nominal+offset*3600000;const p=wallTime(candidate);if(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`===value)matches.push(candidate);}
 if(matches.length!==1)throw Error('This Central time is missing or ambiguous because of daylight saving time. Choose a different time.');
 return new Date(matches[0]).toISOString();
}
export const centralLabel=(value:string)=>new Intl.DateTimeFormat('en-US',{timeZone:zone,dateStyle:'medium',timeStyle:'short'}).format(new Date(value))+' CT';
