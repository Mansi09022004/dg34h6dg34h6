import json,urllib.request,sys,pandas as pd
from datetime import date,timedelta
sys.stdout.reconfigure(encoding='utf-8')
B="https://data.elexon.co.uk/bmrs/api/v1/datasets"
def g(u): return json.load(urllib.request.urlopen(B+u,timeout=180))
def ch(a,b,n):
    while a<b: yield a,min(a+timedelta(days=n),b); a+=timedelta(days=n)
S,E=date(2025,6,1),date(2026,2,1)
A=[];F=[];W=[]
for a,b in ch(S,E,10): A+=g(f"/FUELHH/stream?settlementDateFrom={a}&settlementDateTo={b}&fuelType=WIND")
for a,b in ch(S,E,5): F+=g(f"/WINDFOR/stream?publishDateTimeFrom={a}T00:00:00Z&publishDateTimeTo={b}T00:00:00Z")
for a,b in ch(date(2026,1,1),date(2026,2,1),5): W+=g(f"/AGWS/stream?publishDateTimeFrom={a}T00:00:00Z&publishDateTimeTo={b}T00:00:00Z")
a=pd.DataFrame(A).drop_duplicates('startTime'); a['startTime']=pd.to_datetime(a.startTime); a['h']=a.startTime.dt.floor('h')
a=a.groupby('h').generation.mean().rename('act')
f=pd.DataFrame(F); f['startTime']=pd.to_datetime(f.startTime); f['publishTime']=pd.to_datetime(f.publishTime)
f=f[f.publishTime<=f.startTime]  # forecast made before target hour
best=f.sort_values('publishTime').groupby('startTime').tail(1).set_index('startTime')
d=best.generation.rename('fc').to_frame().join(a,how='inner'); d['err']=d.fc-d.act
m=d.groupby(d.index.strftime('%Y-%m')).agg(n=('err','size'),mean_act=('act','mean'),bias=('err','mean'),mae=('err',lambda x:x.abs().mean()))
m['bias_pct']=m.bias/m.mean_act*100; print(m.round(1).to_string())
print('corr',d.fc.corr(d.act).round(3)); 
x=d.sort_index().loc['2025-06':'2026-01']; import numpy as np; print('slope fc~act', np.polyfit(x.act,x.fc,1).round(3))
# AGWS vs FUELHH in Jan
w=pd.DataFrame(W); w=w[w.businessType=='Wind generation'] if 'businessType' in w else w
w['startTime']=pd.to_datetime(w.startTime); w=w.sort_values('publishTime').drop_duplicates(['startTime','psrType'],keep='last')
t=w.groupby('startTime').quantity.sum(); t.index=pd.to_datetime(t.index)
fh=pd.DataFrame(A).drop_duplicates('startTime'); fh['startTime']=pd.to_datetime(fh.startTime); fh=fh.set_index('startTime').generation
j=pd.concat([fh.rename('fuelhh'),t.rename('agws')],axis=1,join='inner').sort_index().loc['2026-01']
print('Jan FUELHH vs AGWS (half-hourly, n=%d): mean fuelhh %.0f agws %.0f diff %.0f'%(len(j),j.fuelhh.mean(),j.agws.mean(),(j.agws-j.fuelhh).mean()))
