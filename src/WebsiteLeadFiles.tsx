import{useState}from'react';import{supabase}from'./lib/supabase';
type Attachment={id:string;filename:string;mime:string;size_bytes:number};
export default function WebsiteLeadFiles({leadId}:{leadId:string}){
 const[files,setFiles]=useState<Attachment[]|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 async function load(){if(!supabase)return;setBusy(true);const{data,error}=await supabase.rpc('crm_website_lead_attachments',{p_lead:leadId});if(error)setMessage(error.message);else setFiles(data??[]);setBusy(false);}
 async function download(id:string){if(!supabase||busy)return;setBusy(true);const{data,error}=await supabase.rpc('crm_website_attachment',{p_id:id});if(error)setMessage(error.message);else{const bytes=Uint8Array.from(atob(data.data_base64.replace(/\s/g,'')),v=>v.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:data.mime}));const a=document.createElement('a');a.href=url;a.download=data.filename.replace(/[\\/\u0000-\u001f]/g,'_');a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}setBusy(false);}
 return <div className="website-lead-files"><button className="text-button" disabled={busy} onClick={()=>void load()}>Website attachments</button>{message&&<span role="alert" className="subline">{message}</span>}{files?.length===0&&<span className="subline">No website attachments</span>}{files?.map(file=><button className="text-button" key={file.id} disabled={busy} onClick={()=>void download(file.id)}>Download {file.filename} ({Math.ceil(file.size_bytes/1024)} KB)</button>)}</div>;
}
