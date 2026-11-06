import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL="https://wfdkwajrrafnjuhebdbs.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_dmbz3QDWh735dBUPfXR_RA_NTbpjqPw";
const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=id=>document.getElementById(id);
const show=(id,on=true)=>$(id).classList.toggle("hidden",!on);
const status=(message,type="")=>{const el=$("status");el.textContent=message;el.className="status "+type};
let authMode="signin", currentUser=null, recovery=false, selectedCellar=null, selectedAreaLots=[];
function setMode(mode){
  authMode=mode;status("");
  $("auth-title").textContent=({signin:"welcome to your Cellar!",signup:"Create your account.",reset:"Reset your password."})[mode];
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
    const {data,error}=await supabase.rpc("create_my_cellar",{cellar_name:$("cellar-name").value.trim(),cellar_currency:"CAD"});
    if(error)throw error;
    status("Your cellar is ready.","success");
    await loadCellars(data);
  }catch(error){status(error.message||"Unable to create cellar.","error")}finally{button.disabled=false}
});
async function loadCellars(preferredId=null){
  const {data:members,error}=await supabase.from("cellar_members")
    .select("cellar_id,role,cellars(id,name,currency_code)").order("joined_at",{ascending:true});
  if(error){status("Could not load Cellar memberships: "+error.message,"error");return}
  selectedCellar=null;
  show("owner-tools",false);show("role-badge",false);show("collection-button",false);
  show("setup-view",!members?.length);show("cellar-dashboard",!!members?.length);
  show("multi-cellar-notice",(members?.length||0)>1);
  if(!members?.length){$("app-title").textContent="my little Cellar";return}
  const m=members.find(x=>x.cellar_id===preferredId)||members[0];
  if(!m.cellars){status("The linked Cellar could not be loaded.","error");return}
  await selectCellar(m.cellars,m.role);
}
async function selectCellar(cellar,role){
  selectedCellar={id:cellar.id,role};
  show("owner-tools",role==="owner");
  show("manage-users-panel",false);
  $("manage-users-toggle").setAttribute("aria-expanded","false");
  $("role-badge").textContent="Connected as "+role.toUpperCase();
  show("role-badge");show("collection-button");
  $("app-title").textContent=cellar.name;
  show("storage-overview");show("collection-overview",false);
  await loadStorageAreas(cellar.id);
}
async function loadStorageAreas(cellarId){
  const [areasResult,lotsResult]=await Promise.all([
    supabase.from("storage_locations").select("id,parent_id,kind,name,display_order,physical_location,storage_type,max_bottles").eq("cellar_id",cellarId).order("display_order",{ascending:true}),
    supabase.from("inventory_lots").select("id,location_id,quantity").eq("cellar_id",cellarId)
  ]);
  if(areasResult.error||lotsResult.error){
    status("Unable to load Storage Areas: "+(areasResult.error?.message||lotsResult.error?.message),"error");return;
  }
  const locations=areasResult.data||[],lots=lotsResult.data||[];
  selectedAreaLots=lots;
  const byId=new Map(locations.map(location=>[location.id,location]));
  const counts=new Map();
  let unassigned=0;
  for(const lot of lots){
    const quantity=Number(lot.quantity)||0;
    if(!lot.location_id){unassigned+=quantity;continue}
    let location=byId.get(lot.location_id),depth=0,visited=new Set();
    if(!location){unassigned+=quantity;continue}
    while(location&&depth<4&&!visited.has(location.id)){
      visited.add(location.id);
      if(location.kind==="area"){counts.set(location.id,(counts.get(location.id)||0)+quantity);break}
      location=byId.get(location.parent_id);
      depth++;
    }
    if(!location||location.kind!=="area")unassigned+=quantity;
  }
  const areas=locations.filter(x=>x.kind==="area");
  const list=$("storage-area-list");list.replaceChildren();
  $("area-total").textContent=areas.length+" "+(areas.length===1?"area":"areas");
  if(!areas.length){
    const empty=document.createElement("div");empty.className="empty-state";
    const h=document.createElement("h3");h.textContent="No Storage Areas yet";
    const p=document.createElement("p");p.textContent="Your Cellar is ready. Next, we'll add the tools to create a basement Cellar, refrigerator, wine cabinet, and their sections.";
    empty.append(h,p);list.append(empty);
  }
  for(const area of areas){
    const panel=document.createElement("article");panel.className="storage-card";
    const type=area.storage_type||"Storage type not set";
    const place=area.physical_location||"Location not set";
    const heading=document.createElement("h3");heading.textContent=area.name;
    const detail=document.createElement("p");detail.className="muted";detail.textContent=place+" · "+type;
    const qty=document.createElement("p");qty.className="storage-quantity";
    const n=counts.get(area.id)||0;qty.textContent=n+" "+(n===1?"bottle":"bottles");
    const sections=document.createElement("small");sections.textContent=locations.filter(x=>x.parent_id===area.id&&x.kind==="section").length+" sections";
    if(area.max_bottles!==null){const cap=document.createElement("small");cap.textContent="Capacity: "+area.max_bottles+" bottles";panel.append(heading,detail,qty,sections,cap)}
    else panel.append(heading,detail,qty,sections);
    list.append(panel);
  }
  if(unassigned){
    const panel=document.createElement("article");panel.className="storage-card unassigned";
    const heading=document.createElement("h3");heading.textContent="Unassigned bottles";
    const detail=document.createElement("p");detail.className="muted";detail.textContent="Not yet assigned to a Storage Area";
    const qty=document.createElement("p");qty.className="storage-quantity";qty.textContent=unassigned+" bottles";
    panel.append(heading,detail,qty);list.append(panel);
  }
  $("collection-count").textContent=lots.reduce((sum,l)=>sum+(Number(l.quantity)||0),0)+" bottles currently in your Collection.";
}
$("collection-button").addEventListener("click",()=>{
  if(!selectedCellar)return;
  show("storage-overview",false);show("collection-overview");show("collection-button",false);
});
$("back-to-areas").addEventListener("click",()=>{
  show("collection-overview",false);show("storage-overview");show("collection-button");
});
$("manage-users-toggle").addEventListener("click",async()=>{
  if(!selectedCellar||selectedCellar.role!=="owner")return;
  const panel=$("manage-users-panel"),opening=panel.classList.contains("hidden");
  show("manage-users-panel",opening);
  $("manage-users-toggle").setAttribute("aria-expanded",String(opening));
  if(opening)await loadManagedUsers();
});
async function loadManagedUsers(){
  if(!selectedCellar||selectedCellar.role!=="owner")return;
  const {data,error}=await supabase.rpc("list_cellar_users",{target_cellar:selectedCellar.id});
  const list=$("managed-user-list");list.replaceChildren();
  if(error){
    const message=document.createElement("p");message.className="helper";
    message.textContent="User list unavailable. Please run the Supabase users migration (004).";
    list.append(message);return;
  }
  if(!data?.length){list.textContent="No users found.";return}
  for(const u of data){
    const line=document.createElement("div");line.className="managed-user";
    const email=document.createElement("strong");email.textContent=u.email;
    const info=document.createElement("span");info.textContent=u.role.toUpperCase()+" · "+u.status;
    line.append(email,info);list.append(line);
  }
}
$("invite-user-form").addEventListener("submit",async(e)=>{
  e.preventDefault();
  if(!selectedCellar||selectedCellar.role!=="owner"){status("Only an Owner can manage Cellar users.","error");return}
  const button=$("invite-user");button.disabled=true;status("Saving invitation...");
  try{
    const {data,error}=await supabase.rpc("invite_cellar_user",{
      target_cellar:selectedCellar.id,
      invite_email:$("invite-email").value.trim(),
      invite_role:$("invite-role").value
    });
    if(error)throw error;
    status(data==="added"?"Access granted to an existing user.":"Invitation saved. Share the WineCellar website link with this person.","success");
    $("invite-email").value="";
    await loadManagedUsers();
  }catch(error){status(error.message||"Could not invite the user.","error")}
  finally{button.disabled=false}
});
async function refresh(){
  if(recovery){show("recovery-view");show("auth-view",false);show("app-view",false);return}
  const {data:{user},error}=await supabase.auth.getUser();
  if(error||!user){currentUser=null;show("auth-view");show("app-view",false);show("recovery-view",false);return}
  currentUser=user;show("auth-view",false);show("recovery-view",false);show("app-view");
  $("user-email").textContent=user.email||"";
  await loadCellars();
}
supabase.auth.onAuthStateChange((event)=>{
  if(event==="PASSWORD_RECOVERY"){recovery=true;setTimeout(refresh,0)}
  else if(event==="SIGNED_OUT"){recovery=false;setTimeout(refresh,0)}
  else if(event==="SIGNED_IN"&&!recovery){setTimeout(refresh,0)}
});
setMode("signin");refresh();
