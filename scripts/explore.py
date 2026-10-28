import pandas as pd
d="backend/data/"
a=pd.read_csv(d+"actuals.csv",parse_dates=["startTime"]); f=pd.read_csv(d+"forecasts.csv",parse_dates=["publishTime","startTime"])
print(a.generation.describe()); print("missing actual slots:",1536-len(a), a.generation.isna().sum())
f["h"]=(f.startTime-f.publishTime).dt.total_seconds()/3600
print(f.h.describe()); print("start minutes:",f.startTime.dt.minute.unique(), "pub minutes:",f.publishTime.dt.minute.unique(), "pub hours:",sorted(f.publishTime.dt.hour.unique()))
print("pubs/day:",f.groupby(f.publishTime.dt.date).publishTime.nunique().describe())
print(f.generation.describe())
# cutoff rule check for Jan 15
c=pd.Timestamp("2026-01-14 09:00",tz="UTC"); s=f[(f.publishTime<=c)&(f.startTime>=pd.Timestamp("2026-01-15",tz="UTC"))&(f.startTime<pd.Timestamp("2026-01-16",tz="UTC"))]
l=s.sort_values("publishTime").groupby("startTime").tail(1); print(len(l), l.publishTime.unique(), l.h.min(), l.h.max())
# coverage for every Jan day
for day in pd.date_range("2026-01-01","2026-01-31",tz="UTC"):
    c=day-pd.Timedelta(hours=15); s=f[(f.publishTime<=c)&(f.startTime>=day)&(f.startTime<day+pd.Timedelta(days=1))]
    n=s.startTime.nunique()
    if n!=24: print(day.date(),"hourly targets covered:",n)
