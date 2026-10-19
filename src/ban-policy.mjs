export const WINDOW_MS=15*60*1000,MAX_ATTEMPTS=5,BAN_WINDOW_MS=24*60*60*1000,MAX_BANS=5;
export function normalizeAttempts(row,now){
 const state=row?{...row,banTimes:[...(row.banTimes||[])]}:{count:0,start:now,until:0,permanent:false,banTimes:[],last:now};
 state.banTimes=state.banTimes.filter(time=>time>now-BAN_WINDOW_MS&&time<=now);
 if(!state.permanent&&state.until<=now&&(state.until>0||now-state.start>=WINDOW_MS)){state.count=0;state.start=now;state.until=0;}
 return state;
}
export function failedAttempt(row,now){
 const state=normalizeAttempts(row,now);if(state.permanent||state.until>now)return state;
 state.count++;state.last=now;
 if(state.count>=MAX_ATTEMPTS){state.banTimes.push(now);state.permanent=state.banTimes.length>=MAX_BANS;state.until=state.permanent?0:now+WINDOW_MS;}
 return state;
}
export const banResult=(row,now)=>({ok:false,banned:true,permanent:!!row.permanent,retryAfter:row.permanent?null:Math.max(1,Math.ceil((row.until-now)/1000))});
