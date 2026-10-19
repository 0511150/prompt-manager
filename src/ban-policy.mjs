export const WINDOW_MS=15*60*1000,MAX_ATTEMPTS=5;
export function normalizeAttempts(row,now){
 if(!row)return {count:0,start:now,until:0,strikes:0,last:now};
 const state={...row};
 if(now-state.last>24*60*60*1000)state.strikes=0;
 if(state.until<=now&&(state.until>0||now-state.start>=WINDOW_MS)){state.count=0;state.start=now;state.until=0;}
 return state;
}
export function failedAttempt(row,now){const state=normalizeAttempts(row,now);if(state.until>now)return state;state.count++;state.last=now;if(state.count>=MAX_ATTEMPTS){state.until=now+Math.min(WINDOW_MS*2**Math.min(state.strikes,7),24*60*60*1000);state.strikes++;}return state;}
