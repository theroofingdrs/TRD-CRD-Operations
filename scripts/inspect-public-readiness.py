#!/usr/bin/env python3
"""GET-only public configuration inspection. Never queries customer rows or writes.
Uses the existing local public browser binding; prints statuses, never key values.
"""
import json, urllib.request, urllib.error
from pathlib import Path
from datetime import datetime, timezone

def inspect(url, key):
    if url.rstrip('/') != 'https://gubvelngdohrfvqeeabu.supabase.co':
        raise ValueError('Expected TRDCRD public Supabase binding; refusing another destination')
    result={'observed_at':datetime.now(timezone.utc).isoformat(),'scope':'public GET only','administrative_configuration':'unverified'}
    def get(route):
        request=urllib.request.Request(url.rstrip('/')+route,headers={'apikey':key,'Authorization':'Bearer '+key},method='GET')
        try:
            with urllib.request.urlopen(request,timeout=15) as response:return response.status,json.load(response)
        except urllib.error.HTTPError as error:
            try:body=json.load(error)
            except Exception:body={}
            return error.code,body
    status,settings=get('/auth/v1/settings')
    result['auth_settings_http']=status
    if status==200:
        result['public_signup_enabled']=settings.get('disable_signup') is False
        result['email_autoconfirm']=settings.get('mailer_autoconfirm')
    result['anonymous_limit_zero']={}
    for table in ['crm_leads','crm_customers','crm_properties','crm_project_transactions','crm_files','trd_records']:
        status,body=get('/rest/v1/'+table+'?select=id&limit=0')
        result['anonymous_limit_zero'][table]={'http':status,'code':body.get('code') if isinstance(body,dict) else None,'access_denied':True if status in (401,403) else None,'interpretation':'denied' if status in (401,403) else 'catalog verification required'}
    status,_=get('/storage/v1/bucket/roof-doctors-private')
    result['private_bucket_anonymous_metadata_http']=status
    result['private_bucket_actual_configuration']='unverified; anonymous response does not establish existence or policy'
    return result

if __name__=='__main__':
    root=Path(__file__).resolve().parents[1]
    values={}
    for line in (root/'.env.local').read_text().splitlines():
        if line.startswith('VITE_SUPABASE_') and '=' in line:
            k,v=line.split('=',1);values[k]=v.strip().strip('"\'')
    print(json.dumps(inspect(values['VITE_SUPABASE_URL'],values['VITE_SUPABASE_PUBLISHABLE_KEY']),indent=2))
