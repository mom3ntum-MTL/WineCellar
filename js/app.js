import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL="https://wfdkwajrrafnjuhebdbs.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_dmbz3QDWh735dBUPfXR_RA_NTbpjqPw";
const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=id=>document.getElementById(id);
const show=(id,on=true)=>$(id).classList.toggle("hidden",!on);
const status=(message,type="")=>{const el=$("status");el.textContent=message;el.className="status "+type};
let authMode="signin", currentUser=null, recovery=false;
function setMode(mode){
  authMode=mode;status("");
  $("auth-title").textContent=({signin:"Welcome to your cellar.",signup:"Create your account.",reset:"Reset your password."})[mode];
  $("auth-submit").textContent=({signin:"Sign in",signup:"Create account",reset:"Send recovery link"})[mode];
  show("password-label",mode!=="reset");show("password",mode!=="reset");
  $("password").required=mode!=="reset";
  $("password").autocomplete=mode==="signup"?"new-password":"current-password";
  $("mode-signup").textContent=mode==="signup"?"Back to sign in":"Create account";
  $("mode-reset").textContent=mode==="reset"?"Back to sign in":"Forgot password?";
  $("auth-hint").textContent=mode==="signup"?"Please confirm your email if prompted before signing in.":mode==="reset"?"We'll send a secure password-reset link to your email.":"";
}
$("mode-signup").addEventListener("click",()=>setMode(authMode==="signup"?"signin":"signup"));
$("mode-reset").addEventListener("click",()=>setMode(authMode==="reset"?"signin":"reset"));
$("auth-form").addEventListener("submit",async(e)=>{
  e.preventDefault();const email=$("email").value.trim(),password=$("password").value,button=$("auth-submit");
  button.disabled=true;status("Connecting...");
  try{
    let result;
    if(authMode==="signin")result=await supabase.auth.signInWithPassword({email,password});
    else if(authMode==="signup")result=await supabase.auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname}});
    else result=await supabase.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
    if(result.error)throw result.error;
    if(authMode==="reset")status("If this address has an account, a recovery email will arrive shortly.","success");
    else if(authMode==="signup")status("Account request received. Check your email for a confirmation link, then sign in.","success");
    else status("Signed in.","success");
  }catch(error){status(error.message||"Authentication failed.","error")}
  finally{button.disabled=false}
});
$("signout").addEventListener("click",async()=>{const {error}=await supabase.auth.signOut();if(error)status(error.message,"error")});
$("recovery-form").addEventListener("submit",async(e)=>{
  e.preventDefault();const button=e.submitter;button.disabled=true;
  const {error}=await supabase.auth.updateUser({password:$("new-password").value});
  button.disabled=false;
  if(error){status(error.message,"error");return}
  recovery=false;status("Password updated successfully.","success");await refresh();
});
$("setup-form").addEventListener("submit",async(e)=>{
  e.preventDefault();const button=$("create-cellar");button.disabled=true;status("Creating your cellar...");
  try{
    const {data,error}=await supabase.rpc("create_my_cellar",{cellar_name:$("cellar-name").value.trim(),cellar_currency:$("currency").value});
    if(error)throw error;
    status("Your cellar is ready.","success");
    await loadCellars(data);
  }catch(error){status(error.message||"Unable to create cellar.","error")}finally{button.disabled=false}
});
async function loadCellars(preferredId=null){
  const {data:members,error}=await supabase.from("cellar_members").select("cellar_id,role,cellars(id,name,currency_code)").order("joined_at",{ascending:true});
  if(error){status("Could not load cellar memberships: "+error.message,"error");return}
  const list=$("cellar-list");list.replaceChildren();
  show("setup-view",!members?.length);show("cellar-dashboard",!!members?.length);
  for(const m of members||[]){
    if(!m.cellars)continue;
    const item=document.createElement("button");item.type="button";item.className="cellar-item";item.style.textAlign="left";
    const title=document.createElement("span");const strong=document.createElement("strong");strong.textContent=m.cellars.name;
    const detail=document.createElement("small");detail.textContent=m.cellars.currency_code+" · Select cellar";
    title.append(strong,detail);
    const role=document.createElement("span");role.className="pill";role.textContent=m.role;
    item.append(title,role);
    item.addEventListener("click",()=>selectCellar(m.cellars,m.role,item));
    list.append(item);
    if((preferredId&&m.cellar_id===preferredId)||(!preferredId&&list.children.length===1))selectCellar(m.cellars,m.role,item);
  }
}
function selectCellar(cellar,role,element){
  for(const item of $("cellar-list").children)item.classList.remove("selected");
  element.classList.add("selected");
  $("app-title").textContent=cellar.name;
  $("cellar-dashboard").querySelector("p").textContent="Connected as "+role+". Your cellar is ready for the next phase: inventory and storage-area management.";
}
async function refresh(){
  if(recovery){show("recovery-view");show("auth-view",false);show("app-view",false);return}
  const {data:{user},error}=await supabase.auth.getUser();
  if(error||!user){currentUser=null;show("auth-view");show("app-view",false);show("recovery-view",false);return}
  currentUser=user;show("auth-view",false);show("recovery-view",false);show("app-view");
  $("user-label").textContent="Signed in as "+user.email;
  await loadCellars();
}
supabase.auth.onAuthStateChange((event)=>{
  if(event==="PASSWORD_RECOVERY"){recovery=true;setTimeout(refresh,0)}
  else if(event==="SIGNED_OUT"){recovery=false;setTimeout(refresh,0)}
  else if(event==="SIGNED_IN"&&!recovery){setTimeout(refresh,0)}
});
setMode("signin");refresh();
