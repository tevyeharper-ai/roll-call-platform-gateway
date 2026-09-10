<?php
require dirname(__DIR__).'/src/helpers.php';
$fail=0;
function t($ok,$msg){global $fail;echo ($ok?'PASS':'FAIL')."  {$msg}\n";if(!$ok)$fail++;}
$d=json_state();
t(($d['agency']['id']??'')==='dream-kinetic','Dream Kinetic is agency authority');
t(find_client($d,'roll-call')!==null,'Roll Call exists as a client');
t(find_client($d,'sm-group')!==null,'SM Group exists as separate client');
$events=find_app($d,'events');
t($events!==null&&($events['_client_id']??'')==='roll-call','Events belongs to Roll Call');
t(find_app($d,'smg-property')!==null&&find_app($d,'smg-property')['_client_id']==='sm-group','SM property app remains isolated under SM Group');
$p=make_agent_pack($d,'events');
t($p!==null&&str_contains($p['agents'],'Roll Call'),'Events agent pack has client context');
t($p!==null&&str_contains($p['agents'],'Explore/Research/Design modes must not mutate source code.'),'AI non-mutation lifecycle rule is exported');
try{$purl=parse_database_url('postgresql://user:pass@db.example.com:5432/forge?sslmode=require');t($purl['database']==='forge'&&$purl['sslmode']==='require','PostgreSQL URL parser');}catch(Throwable $e){t(false,'PostgreSQL URL parser');}
$files=glob(dirname(__DIR__).'/database/migrations/*.sql');t(count($files)>=2,'Production migration set exists');
$checks=certification_checks($d);t(count($checks)>=6,'Certification gate set exists');
exit($fail?1:0);
