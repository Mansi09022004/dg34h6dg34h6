import json,urllib.request,sys,pandas as pd
from datetime import date,timedelta
sys.stdout.reconfigure(encoding='utf-8')
B="https://data.elexon.co.uk/bmrs/api/v1/datasets"
W=[];a=date(2026,1,1)
while a<date(2026,2,1):
    b=a+timedelta(days=5); W+=json.load(urllib.request.urlopen(f"{B}/AGWS/stream?publishDateTimeFrom={a}T00:00:00Z&publishDateTimeTo={b}T00:00:00Z",timeout=180)); a=b
w=pd.DataFrame(W); print(w.psrType.value_counts().to_dict(), w.businessType.value_counts().to_dict())
w['startTime']=pd.to_datetime(w.startTime); w=w.sort_values('publishTime').drop_duplicates(['startTime','psrType'],keep='last')
t=w.groupby('startTime').quantity.sum().resample('h').mean().rename('agws')
fc=pd.read_csv('backend/data/forecasts.csv',parse_dates=['publishTime','startTime']); fc=fc[fc.publishTime<=fc.startTime]
best=fc.sort_values('publishTime').groupby('startTime').tail(1).set_index('startTime').generation.rename('fc')
ac=pd.read_csv('backend/data/actuals.csv',parse_dates=['startTime']).set_index('startTime').generation.resample('h').mean().rename('fuelhh')
d=pd.concat([best,t,ac],axis=1,join='inner').sort_index().loc['2026-01-01':'2026-01-31 23:00']
print(len(d)); print(d.mean().round(0).to_dict())
for k in ('fuelhh','agws'): e=d.fc-d[k]; print(k,'bias %.0f mae %.0f'%(e.mean(),e.abs().mean()))
print('agws-fuelhh', (d.agws-d.fuelhh).mean().round(0), (d.agws-d.fuelhh).std().round(0))
print(d.loc['2026-01-15 00:00':'2026-01-15 03:00'].round(0))
