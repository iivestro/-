import concurrent.futures
import hashlib
import os
import subprocess
import threading
import time
import uuid

def sql(statement):
    return subprocess.run(["psql","-X","-q","-At","-v","ON_ERROR_STOP=1","-c",statement],capture_output=True,text=True,timeout=30)

def patient(i):
    return str(uuid.UUID(hashlib.md5(f"synthetic-patient-{i}".encode()).hexdigest()))

def batch(kind, duplicate=False):
    gate=threading.Barrier(20)
    def worker(i):
        pid=patient(100 if duplicate else i+1)
        rid=str(uuid.uuid4())
        day=2 if duplicate else 1
        if kind=="doctor":
            table="appointments"
            columns="id,patient_id,doctor_id,requested_date,status"
            values=f"'{rid}','{pid}','20000000-0000-4000-8000-000000000001'"
        else:
            table="center_appointments"
            columns="id,patient_id,center_id,center_doctor_id,requested_date,status"
            values=f"'{rid}','{pid}','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003'"
        statement=f"BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL request.jwt.claim.sub='{pid}'; INSERT INTO {table}({columns}) VALUES({values},(now() AT TIME ZONE 'Asia/Baghdad')::date+{day},'pending'); COMMIT;"
        gate.wait(timeout=10)
        return sql(statement)
    start=time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
        results=list(pool.map(worker,range(20)))
    successes=sum(x.returncode==0 for x in results)
    expected=1 if duplicate else 5
    message="duplicate key value" if duplicate else "Daily capacity reached"
    for x in results:
        if x.returncode!=0 and message not in x.stderr:
            raise AssertionError("Unexpected SQL failure: "+x.stderr[:500])
    assert successes==expected,(kind,duplicate,successes,expected)
    table="appointments" if kind=="doctor" else "center_appointments"
    day=2 if duplicate else 1
    count=sql(f"SELECT count(*) FROM {table} WHERE requested_date=(now() AT TIME ZONE 'Asia/Baghdad')::date+{day};")
    assert count.returncode==0 and int(count.stdout.strip())==expected
    print(f"PASS {kind} {'duplicates' if duplicate else 'daily capacity'}: 20 concurrent attempts, {successes} committed, {20-successes} rejected, {time.monotonic()-start:.3f}s",flush=True)

for kind in ("doctor","center"):
    batch(kind)
    batch(kind,True)
print("PASS isolated PostgreSQL concurrency; no claims about Supabase deployment or 10,000 simultaneous sessions.")
