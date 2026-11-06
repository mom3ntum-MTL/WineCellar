import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL="https://wfdkwajrrafnjuhebdbs.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_dmbz3QDWh735dBUPfXR_RA_NTbpjqPw";
const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=id=>document.getElementById(id);
const show=(id,on=true)=>$(id).classList.toggle("hidden",!on);
const status=(message,type="")=>{const el=$("status");el.textContent=message;el.className="status "+type};
let authMode="signin", currentUser=null, recovery=false, selectedCellar=null, selectedAreaLots=[], currentLocations=[], storageEditing=null;
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
  show("add-storage-area",role==="owner");
  show("manage-users-panel",false);
  $("manage-users-toggle").setAttribute("aria-expanded","false");
  $("role-badge").textContent="Connected as "+role.toUpperCase();
  show("role-badge");show("collection-button");
  $("app-title").textContent=cellar.name;
  show("storage-overview");show("collection-overview",false);
  await loadStorageAreas(cellar.id);
}
const makeElement=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=String(text);return el};
function childLocationCount(id){return currentLocations.filter(l=>l.parent_id===id).length}
function descendantsOf(id){
  const ids=new Set([id]);
  let changed=true;
  while(changed){changed=false;for(const l of currentLocations)if(l.parent_id&&ids.has(l.parent_id)&&!ids.has(l.id)){ids.add(l.id);changed=true}}
  return ids;
}
function locationBottleCount(id){
  const ids=descendantsOf(id);
  return selectedAreaLots.reduce((sum,l)=>sum+(l.location_id&&ids.has(l.location_id)?Number(l.quantity)||0:0),0);
}
function actionButton(text,handler,style=""){
  const button=makeElement("button","small-action "+style,text);
  button.type="button";button.addEventListener("click",handler);
  return button;
}
function storageActions(location){
  const actions=makeElement("div","storage-actions");
  if(selectedCellar?.role!=="owner")return actions;
  actions.append(actionButton("Edit",()=>openStorageForm("edit",location)));
  if(location.kind!=="subsection")
    actions.append(actionButton(location.kind==="area"?"+ Section":"+ Subsection",()=>openStorageForm("create",null,location)));
  actions.append(actionButton("Delete",()=>deleteStorageLocation(location),"danger-action"));
  return actions;
}
function renderStorageNode(location){
  const line=makeElement("div",location.kind==="section"?"storage-node section-node":"storage-node subsection-node");
  const content=makeElement("div","storage-node-copy");
  content.append(makeElement("strong","",location.name));
  const qty=locationBottleCount(location.id);
  const info=makeElement("small","",qty+" "+(qty===1?"bottle":"bottles")+(location.max_bottles!==null?" / max "+location.max_bottles:""));
  content.append(info);line.append(content,storageActions(location));
  const block=makeElement("div","storage-node-group");block.append(line);
  for(const child of currentLocations.filter(x=>x.parent_id===location.id))
    block.append(renderStorageNode(child));
  return block;
}
async function loadStorageAreas(cellarId){
  const [areasResult,lotsResult]=await Promise.all([
    supabase.from("storage_locations").select("id,parent_id,kind,name,display_order,physical_location,storage_type,max_bottles").eq("cellar_id",cellarId).order("display_order",{ascending:true}),
    supabase.from("inventory_lots").select("id,location_id,quantity").eq("cellar_id",cellarId)
  ]);
  if(selectedCellar?.id!==cellarId)return;
  if(areasResult.error||lotsResult.error){
    status("Unable to load Storage Areas: "+(areasResult.error?.message||lotsResult.error?.message),"error");return;
  }
  currentLocations=areasResult.data||[];
  selectedAreaLots=lotsResult.data||[];
  const areas=currentLocations.filter(x=>x.kind==="area");
  const list=$("storage-area-list");list.replaceChildren();
  $("area-total").textContent=areas.length+" "+(areas.length===1?"area":"areas");
  if(!areas.length){
    const empty=makeElement("div","empty-state");
    empty.append(makeElement("h3","","No Storage Areas yet"),
      makeElement("p","","Create a Storage Area such as a Basement Cellar or a Kitchen Refrigerator. Then add optional Sections and Subsections."));
    list.append(empty);
  }
  for(const area of areas){
    const panel=makeElement("article","storage-card");
    panel.append(makeElement("h3","",area.name),
      makeElement("p","muted",(area.physical_location||"Physical location not set")+" · "+(area.storage_type||"Storage type not set")));
    const qty=locationBottleCount(area.id);
    panel.append(makeElement("p","storage-quantity",qty+" "+(qty===1?"bottle":"bottles")+
      (area.max_bottles!==null?" / "+area.max_bottles:"")));
    panel.append(makeElement("small","",childLocationCount(area.id)+" Sections"));
    panel.append(storageActions(area));
    const children=currentLocations.filter(x=>x.parent_id===area.id);
    if(children.length){const nested=makeElement("div","location-children");for(const child of children)nested.append(renderStorageNode(child));panel.append(nested)}
    list.append(panel);
  }
  const known=new Set(currentLocations.map(x=>x.id));
  const unassigned=selectedAreaLots.reduce((sum,l)=>sum+((!l.location_id||!known.has(l.location_id))?Number(l.quantity)||0:0),0);
  if(unassigned){
    const panel=makeElement("article","storage-card");
    panel.append(makeElement("h3","","Unassigned bottles"),makeElement("p","storage-quantity",unassigned+" bottles"));
    list.append(panel);
  }
  $("collection-count").textContent=selectedAreaLots.reduce((sum,l)=>sum+(Number(l.quantity)||0),0)+" bottles currently in your Collection.";
}
function closeStorageForm(){$("storage-dialog").close();storageEditing=null}
function openStorageForm(mode,location=null,parent=null){
  if(selectedCellar?.role!=="owner")return;
  storageEditing={mode,id:location?.id||null,kind:location?.kind||(!parent?"area":parent.kind==="area"?"section":"subsection"),parent_id:location?.parent_id||parent?.id||null,cellar_id:selectedCellar.id};
  const editing=mode==="edit";
  $("storage-form").reset();
  $("storage-dialog-title").textContent=(editing?"Edit ":"Add ")+({area:"Storage Area",section:"Section",subsection:"Subsection"})[storageEditing.kind];
  const parentName=currentLocations.find(x=>x.id===storageEditing.parent_id)?.name;
  $("storage-parent-summary").textContent=parentName?"Inside: "+parentName:"An Area can contain Sections and Subsections.";
  show("area-only-fields",storageEditing.kind==="area");
  $("storage-name").value=location?.name||"";
  $("storage-physical-location").value=location?.physical_location||"";
  const type=location?.storage_type||"";
  const predefined=Array.from($("storage-type").options).some(o=>o.value===type);
  $("storage-type").value=predefined?type:"Other";
  $("storage-type-custom").value=predefined?"":type;
  toggleStorageCustomType();
  $("storage-capacity").value=location?.max_bottles??"";
  $("storage-dialog").showModal();
  $("storage-name").focus();
}
function toggleStorageCustomType(){
  const custom=$("storage-type").value==="Other";
  show("storage-type-custom-label",custom);show("storage-type-custom",custom);
}
$("storage-type").addEventListener("change",toggleStorageCustomType);
$("add-storage-area").addEventListener("click",()=>openStorageForm("create"));
$("cancel-storage").addEventListener("click",closeStorageForm);
$("cancel-storage-bottom").addEventListener("click",closeStorageForm);
$("storage-dialog").addEventListener("close",()=>{storageEditing=null});
$("storage-form").addEventListener("submit",async(e)=>{
  e.preventDefault();
  const editing=storageEditing;if(!editing||selectedCellar?.role!=="owner"||editing.cellar_id!==selectedCellar.id)return;
  const name=$("storage-name").value.trim(),capacityText=$("storage-capacity").value.trim();
  const capacity=capacityText===""?null:Number(capacityText);
  if(!name||name.length>120){status("Enter a Storage Area, Section, or Subsection name.","error");return}
  if(capacity!==null&&(!Number.isInteger(capacity)||capacity<=0)){status("Maximum bottles must be a positive whole number.","error");return}
  const values={name,max_bottles:capacity};
  if(editing.kind==="area"){
    values.physical_location=$("storage-physical-location").value.trim()||null;
    values.storage_type=($("storage-type").value==="Other"?$("storage-type-custom").value.trim():$("storage-type").value)||null;
  }
  if(editing.mode==="create"){
    Object.assign(values,{cellar_id:editing.cellar_id,kind:editing.kind,parent_id:editing.parent_id});
  }
  const button=$("save-storage");button.disabled=true;
  try{
    const query=supabase.from("storage_locations");
    const {error}=editing.mode==="edit"
      ?await query.update(values).eq("id",editing.id).eq("cellar_id",editing.cellar_id)
      :await query.insert(values);
    if(error)throw error;
    closeStorageForm();
    await loadStorageAreas(editing.cellar_id);
    status((editing.mode==="edit"?"Updated ":"Created ")+editing.kind+".","success");
  }catch(error){status(error.message||"Could not save this location.","error")}
  finally{button.disabled=false}
});
async function deleteStorageLocation(location){
  if(selectedCellar?.role!=="owner")return;
  const children=childLocationCount(location.id);
  const lots=selectedAreaLots.filter(l=>l.location_id===location.id);
  if(children){status("Remove this location's Sections/Subsections before deleting it.","error");return}
  if(lots.length){status("Move or remove bottles assigned to this location before deleting it.","error");return}
  if(!window.confirm("Delete "+location.kind+" “"+location.name+"”? This cannot be undone."))return;
  const cellarId=selectedCellar.id;
  const {data,error}=await supabase.from("storage_locations").delete().eq("id",location.id).eq("cellar_id",cellarId).select("id");
  if(error){status("Unable to delete: "+error.message,"error");return}
  if(!data?.length){status("Location was not deleted. Check your permissions.","error");return}
  await loadStorageAreas(cellarId);status("Location deleted.","success");
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
