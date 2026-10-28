import json,urllib.request,sys,pandas as pd
sys.stdout.reconfigure(encoding='utf-8')
B="https://data.elexon.co.uk/bmrs/api/v1/datasets"
def g(u): return json.load(urllib.request.urlopen(B+u,timeout=120))
# raw spot-check: fresh fetch for 15 Jan 2026 (not from our CSVs)
raw_a=pd.DataFrame(g("/FUELHH/stream?settlementDateFrom=2026-01-15&settlementDateTo=2026-01-15&fuelType=WIND"))
print(raw_a[['startTime','settlementPeriod','generation']].sort_values('startTime').head(4).to_string())
raw_f=pd.DataFrame(g("/WINDFOR/stream?publishDateTimeFrom=2026-01-14T07:00:00Z&publishDateTimeTo=2026-01-14T08:00:00Z"))
print(raw_f[raw_f.startTime.between('2026-01-15T00:00:00Z','2026-01-15T03:00:00Z')][['publishTime','startTime','generation']].to_string())
# alternative actual sources
for ep in ["/AGWS/stream?publishDateTimeFrom=2026-01-15T00:00:00Z&publishDateTimeTo=2026-01-15T06:00:00Z","/FUELINST/stream?publishDateTimeFrom=2026-01-15T00:00:00Z&publishDateTimeTo=2026-01-15T00:20:00Z&fuelType=WIND"]:
    try:
        d=g(ep); print(ep[:20],len(d)); print(json.dumps(d[:3])[:700])
    except Exception as e: print(ep[:20],e)
