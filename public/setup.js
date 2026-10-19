const form=document.getElementById('setup-form'),error=document.getElementById('error'),submit=document.getElementById('submit');
form.addEventListener('submit',async event=>{
 event.preventDefault();error.textContent='';const data=new FormData(form);
 if(data.get('password')!==data.get('confirm')){error.textContent='两次输入的密码不一致';return;}
 submit.disabled=true;submit.textContent='正在设置…';
 try{const response=await fetch('/auth/setup',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(data))});const result=await response.json();if(response.ok){form.reset();location.replace('/');return;}error.textContent=result.error||'设置未完成';}catch{error.textContent='网络连接失败，请稍后重试';}
 submit.disabled=false;submit.textContent='设置密码并进入 →';
});
