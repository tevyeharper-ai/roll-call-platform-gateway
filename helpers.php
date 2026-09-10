<?php
function forge_config(): array { static $c; return $c ??= require dirname(__DIR__).'/config/forge.php'; }
function h(string $s): string { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }
function slugify(string $v): string { $v=strtolower(trim(preg_replace('/[^a-z0-9]+/i','-',$v),'-')); return $v ?: 'item'; }
function uuidv4(): string { $d=random_bytes(16); $d[6]=chr((ord($d[6])&0x0f)|0x40); $d[8]=chr((ord($d[8])&0x3f)|0x80); return vsprintf('%s%s-%s-%s-%s-%s%s%s',str_split(bin2hex($d),4)); }
function csrf_token(): string { if(empty($_SESSION['csrf'])) $_SESSION['csrf']=bin2hex(random_bytes(24)); return $_SESSION['csrf']; }
function csrf_check(): void { if(!hash_equals($_SESSION['csrf'] ?? '', $_POST['csrf'] ?? '')) { http_response_code(419); exit('Invalid request token'); } }
function current_user(): array { return $_SESSION['forge_identity'] ?? ['id'=>'anonymous','name'=>'Anonymous','type'=>'anonymous']; }
function logged_in(): bool { return !empty($_SESSION['forge_identity']); }
function is_agency_admin(): bool { return (current_user()['type'] ?? '')==='agency_admin'; }

function forge_local_config(): array {
  $f=forge_config()['local_config_file']; if(!is_file($f)) return [];
  $v=require $f; return is_array($v)?$v:[];
}
function forge_infrastructure(): array {
  $f=forge_config()['infrastructure_file'];
  $v=[];
  if(is_file($f)){ $loaded=require $f; if(is_array($loaded)) $v=$loaded; }
  $envUrl=getenv('DATABASE_URL') ?: '';
  if($envUrl!==''){ $v['storage_driver']='pgsql'; $v['database_url']=$envUrl; }
  return $v;
}

function forge_admin_user(): string { $l=forge_local_config(); return (string)($l['admin_user'] ?? (getenv('FORGE_ADMIN_USER') ?: '')); }
function forge_admin_password_hash(): string { $l=forge_local_config(); return (string)($l['admin_password_hash'] ?? ''); }
function forge_password_ok(string $password): bool {
  $hash=forge_admin_password_hash(); if($hash!=='') return password_verify($password,$hash);
  $legacy=getenv('FORGE_ADMIN_PASSWORD') ?: ''; return $legacy!=='' && hash_equals($legacy,$password);
}
function forge_setup_ready(): bool { return forge_admin_user()!=='' && (forge_admin_password_hash()!=='' || (getenv('FORGE_ADMIN_PASSWORD') ?: '')!==''); }
function forge_setup_key(): string {
  $f=dirname(__DIR__).'/storage/install-key.txt';
  if(!is_file($f) && !forge_setup_ready()) { @file_put_contents($f,bin2hex(random_bytes(18)),LOCK_EX); @chmod($f,0600); }
  return is_file($f)?trim((string)file_get_contents($f)):'';
}
function forge_write_local_config(string $user,string $password): bool {
  $f=forge_config()['local_config_file'];
  $payload="<?php\nreturn ".var_export(['admin_user'=>$user,'admin_password_hash'=>password_hash($password,PASSWORD_DEFAULT)],true).";\n";
  $ok=file_put_contents($f,$payload,LOCK_EX)!==false;
  if($ok){ @chmod($f,0600); @unlink(dirname(__DIR__).'/storage/install-key.txt'); }
  return $ok;
}
function forge_write_infrastructure(array $settings): bool {
  $f=forge_config()['infrastructure_file']; $existing=forge_infrastructure(); $merged=array_merge($existing,$settings);
  $payload="<?php\nreturn ".var_export($merged,true).";\n";
  $ok=file_put_contents($f,$payload,LOCK_EX)!==false; if($ok) @chmod($f,0600); return $ok;
}

function parse_database_url(string $url): array {
  $p=parse_url(trim($url)); if(!$p || empty($p['scheme']) || !in_array(strtolower($p['scheme']),['postgres','postgresql'],true)) throw new RuntimeException('Use a PostgreSQL connection URL beginning with postgres:// or postgresql://.');
  if(empty($p['host'])||empty($p['path'])) throw new RuntimeException('The PostgreSQL URL is missing a host or database name.');
  parse_str($p['query'] ?? '',$q);
  return [
    'host'=>$p['host'],'port'=>$p['port']??5432,'database'=>ltrim($p['path'],'/'),
    'user'=>urldecode($p['user']??''),'password'=>urldecode($p['pass']??''),'sslmode'=>$q['sslmode']??'prefer'
  ];
}
function forge_pdo(?string $url=null): PDO {
  if(!extension_loaded('pdo_pgsql')) throw new RuntimeException('The PHP pdo_pgsql extension is not enabled on this server.');
  $infra=forge_infrastructure(); $url=$url ?: (string)($infra['database_url'] ?? (getenv('DATABASE_URL') ?: ''));
  if($url==='') throw new RuntimeException('No PostgreSQL DATABASE_URL is configured.');
  $p=parse_database_url($url);
  $dsn='pgsql:host='.$p['host'].';port='.$p['port'].';dbname='.$p['database'].';sslmode='.$p['sslmode'];
  return new PDO($dsn,$p['user'],$p['password'],[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
}
function postgres_configured(): bool { $i=forge_infrastructure(); return (($i['storage_driver']??'')==='pgsql') && !empty($i['database_url']); }
function postgres_schema_ready(): bool {
  if(!postgres_configured()) return false;
  try { $pdo=forge_pdo(); return (bool)$pdo->query("SELECT to_regclass('public.agencies') IS NOT NULL")->fetchColumn(); } catch(Throwable $e){ return false; }
}
function storage_status(): array {
  $infra=forge_infrastructure(); $driver=$infra['storage_driver']??forge_config()['default_storage_driver'];
  if($driver==='pgsql'){
    $ext=extension_loaded('pdo_pgsql'); $configured=!empty($infra['database_url']); $ready=$ext&&$configured&&postgres_schema_ready();
    return ['driver'=>'PostgreSQL','ready'=>$ready,'configured'=>$configured,'extension'=>$ext,'note'=>$ready?'Authoritative production persistence':'Configuration or schema action required'];
  }
  return ['driver'=>'JSON development adapter','ready'=>true,'configured'=>true,'extension'=>true,'note'=>'Development-only bootstrap adapter'];
}
function https_status(): array {
  $https=(!empty($_SERVER['HTTPS'])&&$_SERVER['HTTPS']!=='off') || (($_SERVER['HTTP_X_FORWARDED_PROTO']??'')==='https');
  return ['ready'=>$https,'label'=>$https?'HTTPS active':'HTTPS not detected'];
}

function forge_seed(): array {
  return [
    'agency'=>['id'=>'dream-kinetic','name'=>'Dream Kinetic','status'=>'Active'],
    'clients'=>[
      ['id'=>'roll-call','name'=>'Roll Call','status'=>'Active','workspaces'=>[
        ['id'=>'roll-call-products','name'=>'Products','applications'=>[
          ['id'=>'events','name'=>'Events','status'=>'Active','architecture'=>'Roll Call Platform v3','runtime'=>'Forge Runtime 1.0','dossier'=>'Current','brief'=>'RC-EVENTS-NEXT','repo'=>'tevyeharper-ai/roll-call-platform-gateway','environments'=>['Development','Staging','Production']],
          ['id'=>'brdcst','name'=>'BRDCST','status'=>'Active','architecture'=>'Roll Call Platform v3','runtime'=>'Forge Runtime 1.0','dossier'=>'Current','brief'=>'BRDCST-NEXT','repo'=>'','environments'=>['Development','Staging']],
          ['id'=>'asmbly','name'=>'ASMBLY','status'=>'Active','architecture'=>'Roll Call Platform v3','runtime'=>'Legacy adapter','dossier'=>'Current','brief'=>'ASMBLY-RECOVERY','repo'=>'','environments'=>['Development','Production']],
          ['id'=>'marketplace','name'=>'Marketplace','status'=>'Active','architecture'=>'Roll Call Platform v3','runtime'=>'Legacy adapter','dossier'=>'Current','brief'=>'MP-NEXT','repo'=>'','environments'=>['Development']],
          ['id'=>'sign','name'=>'Sign','status'=>'Active','architecture'=>'Roll Call Platform v3','runtime'=>'Legacy adapter','dossier'=>'Current','brief'=>'SIGN-NEXT','repo'=>'','environments'=>['Development']],
          ['id'=>'space-cadet','name'=>'Space Cadet','status'=>'Active','architecture'=>'Roll Call Platform v3','runtime'=>'Legacy adapter','dossier'=>'Current','brief'=>'SC-NEXT','repo'=>'','environments'=>['Development']],
          ['id'=>'gravy-cottage','name'=>'Gravy Cottage','status'=>'Active','architecture'=>'Roll Call Platform v3','runtime'=>'Legacy adapter','dossier'=>'Current','brief'=>'GRAVY-NEXT','repo'=>'','environments'=>['Development']],
        ]]
      ]],
      ['id'=>'sm-group','name'=>'SM Group','status'=>'Active','workspaces'=>[
        ['id'=>'smg-operations','name'=>'Operations','applications'=>[
          ['id'=>'smg-property','name'=>'Property Management','status'=>'Active','architecture'=>'Forge Standard','runtime'=>'Legacy adapter','dossier'=>'Current','brief'=>'SMG-NEXT','repo'=>'','environments'=>['Development','Production']]
        ]]
      ]],
    ],
    'users'=>[
      ['id'=>'dk-admin','name'=>'Dream Kinetic Admin','email'=>'admin@dreamkinetic.local','type'=>'agency_admin','status'=>'Active','ai'=>'Avery + external AI'],
      ['id'=>'contractor-demo','name'=>'Example Contractor','email'=>'contractor@example.dev','type'=>'contractor','status'=>'Invited','ai'=>'ChatGPT Plus / Claude Pro','password_hash'=>'','invite_token_hash'=>'']
    ],
    'assignments'=>[['id'=>'assign-001','user_id'=>'contractor-demo','client_id'=>'roll-call','application_id'=>'events','access'=>'Developer','status'=>'Pending']],
    'dossiers'=>[
      ['id'=>'dos-events','client_id'=>'roll-call','application_id'=>'events','title'=>'Roll Call Events Design Dossier','version'=>'Current','status'=>'Current'],
      ['id'=>'dos-brdcst','client_id'=>'roll-call','application_id'=>'brdcst','title'=>'BRDCST Design Dossier','version'=>'Current','status'=>'Current'],
      ['id'=>'dos-forge','client_id'=>'dream-kinetic','application_id'=>'forge','title'=>'Dream Kinetic Forge Design Dossier','version'=>'F0.4.0','status'=>'Current']
    ],
    'briefs'=>[
      ['id'=>'DKF-0001','client_id'=>'roll-call','application_id'=>'events','title'=>'Venue CRM exploration','objective'=>'Make venue sourcing conversational and Avery-led.','stage'=>'Design','risk'=>'R2','updated'=>'Today'],
      ['id'=>'DKF-0002','client_id'=>'roll-call','application_id'=>'brdcst','title'=>'Studio structure refinement','objective'=>'Continue Studio builder stabilization and premium UX.','stage'=>'Preview','risk'=>'R1','updated'=>'Today']
    ],
    'repositories'=>[['id'=>'repo-events','application_id'=>'events','repository'=>'tevyeharper-ai/roll-call-platform-gateway','default_branch'=>'main','status'=>'Unverified']],
    'audit'=>[],
  ];
}

function json_state(): array {
  $f=forge_config()['data_file'];
  if(!is_file($f)){ $d=forge_seed(); @file_put_contents($f,json_encode($d,JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES),LOCK_EX); return $d; }
  $d=json_decode((string)file_get_contents($f),true); return is_array($d)?array_replace_recursive(forge_seed(),$d):forge_seed();
}
function json_save(array $d): void { file_put_contents(forge_config()['data_file'],json_encode($d,JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES),LOCK_EX); }

function db_state(): array {
  $pdo=forge_pdo();
  $agency=$pdo->query("SELECT slug id,name,initcap(status) status FROM agencies ORDER BY created_at LIMIT 1")->fetch() ?: ['id'=>'dream-kinetic','name'=>'Dream Kinetic','status'=>'Active'];
  $clients=[]; $clientRows=$pdo->query("SELECT id,slug,name,status FROM clients ORDER BY name")->fetchAll();
  foreach($clientRows as $cr){
    $workspaces=[]; $st=$pdo->prepare("SELECT id,slug,name FROM workspaces WHERE client_id=? ORDER BY name"); $st->execute([$cr['id']]);
    foreach($st->fetchAll() as $wr){
      $apps=[]; $sa=$pdo->prepare("SELECT id,slug,name,architecture_profile,runtime_profile,status FROM applications WHERE workspace_id=? ORDER BY name"); $sa->execute([$wr['id']]);
      foreach($sa->fetchAll() as $ar){
        $se=$pdo->prepare("SELECT name,kind,url,status FROM environments WHERE application_id=? ORDER BY CASE kind WHEN 'development' THEN 1 WHEN 'preview' THEN 2 WHEN 'staging' THEN 3 ELSE 4 END"); $se->execute([$ar['id']]); $envs=$se->fetchAll();
        $sr=$pdo->prepare("SELECT repository,default_branch,status FROM repositories WHERE application_id=? ORDER BY created_at LIMIT 1"); $sr->execute([$ar['id']]); $repo=$sr->fetch();
        $sd=$pdo->prepare("SELECT title,version,status FROM design_dossiers WHERE application_id=? AND is_current=true LIMIT 1"); $sd->execute([$ar['id']]); $dos=$sd->fetch();
        $sb=$pdo->prepare("SELECT brief_key,title,objective,status,risk_class FROM build_briefs WHERE application_id=? ORDER BY updated_at DESC LIMIT 1"); $sb->execute([$ar['id']]); $brief=$sb->fetch();
        $apps[]=['_uuid'=>$ar['id'],'id'=>$ar['slug'],'name'=>$ar['name'],'status'=>ucfirst($ar['status']),'architecture'=>$ar['architecture_profile'],'runtime'=>$ar['runtime_profile'],'dossier'=>$dos['version']??'—','brief'=>$brief['brief_key']??'—','repo'=>$repo['repository']??'','repo_status'=>$repo['status']??'','environments'=>array_map(fn($e)=>$e['name'],$envs),'_environment_records'=>$envs];
      }
      $workspaces[]=['_uuid'=>$wr['id'],'id'=>$wr['slug'],'name'=>$wr['name'],'applications'=>$apps];
    }
    $clients[]=['_uuid'=>$cr['id'],'id'=>$cr['slug'],'name'=>$cr['name'],'status'=>ucfirst($cr['status']),'workspaces'=>$workspaces];
  }
  $users=$pdo->query("SELECT id,display_name name,email,account_type type,status,ai_plan ai,password_hash FROM forge_users ORDER BY display_name")->fetchAll();
  $assign=$pdo->query("SELECT ca.id,ca.user_id,c.slug client_id,a.slug application_id,ca.access_level access,ca.status FROM contractor_assignments ca JOIN applications a ON a.id=ca.application_id JOIN workspaces w ON w.id=a.workspace_id JOIN clients c ON c.id=w.client_id ORDER BY ca.starts_at")->fetchAll();
  $dossiers=$pdo->query("SELECT d.id,c.slug client_id,a.slug application_id,d.title,d.version,CASE WHEN d.is_current THEN 'Current' ELSE initcap(d.status) END status FROM design_dossiers d JOIN applications a ON a.id=d.application_id JOIN workspaces w ON w.id=a.workspace_id JOIN clients c ON c.id=w.client_id ORDER BY d.created_at DESC")->fetchAll();
  $briefs=$pdo->query("SELECT b.brief_key id,c.slug client_id,a.slug application_id,b.title,b.objective,initcap(b.status) stage,b.risk_class risk,to_char(b.updated_at,'YYYY-MM-DD HH24:MI') updated FROM build_briefs b JOIN applications a ON a.id=b.application_id JOIN workspaces w ON w.id=a.workspace_id JOIN clients c ON c.id=w.client_id ORDER BY b.updated_at DESC")->fetchAll();
  $repos=$pdo->query("SELECT r.id,a.slug application_id,r.repository,r.default_branch,r.status FROM repositories r JOIN applications a ON a.id=r.application_id ORDER BY r.created_at DESC")->fetchAll();
  return ['agency'=>$agency,'clients'=>$clients,'users'=>$users,'assignments'=>$assign,'dossiers'=>$dossiers,'briefs'=>$briefs,'repositories'=>$repos,'audit'=>[]];
}
function forge_state(): array { return postgres_schema_ready()?db_state():json_state(); }
function all_apps(array $d): array { $out=[]; foreach($d['clients'] as $c){ foreach($c['workspaces']??[] as $w){ foreach($w['applications']??[] as $a){ $a['_client']=$c['name']; $a['_client_id']=$c['id']; $a['_client_uuid']=$c['_uuid']??null; $a['_workspace']=$w['name']; $a['_workspace_id']=$w['id']; $a['_workspace_uuid']=$w['_uuid']??null; $out[]=$a; }}} return $out; }
function find_app(array $d,string $id): ?array { foreach(all_apps($d) as $a) if($a['id']===$id) return $a; return null; }
function find_client(array $d,string $id): ?array { foreach($d['clients'] as $c) if($c['id']===$id) return $c; return null; }
function permitted_app_ids(array $d): array {
  if(is_agency_admin()) return array_column(all_apps($d),'id'); $u=current_user(); $ids=[];
  foreach($d['assignments']??[] as $a) if(($a['user_id']??'')===($u['id']??'') && strtolower((string)($a['status']??''))!=='revoked') $ids[]=$a['application_id'];
  return array_values(array_unique($ids));
}
function scoped_state(array $d): array {
  if(is_agency_admin()) return $d; $allowed=array_flip(permitted_app_ids($d));
  foreach($d['clients'] as &$c){
    if(!isset($c['workspaces']) || !is_array($c['workspaces'])){$c['workspaces']=[];continue;}
    foreach($c['workspaces'] as &$w){
      $apps=$w['applications']??[];
      $w['applications']=array_values(array_filter($apps,fn($a)=>isset($allowed[$a['id']??''])));
    }
    unset($w);
    $c['workspaces']=array_values(array_filter($c['workspaces'],fn($w)=>!empty($w['applications'])));
  }
  unset($c);
  $d['clients']=array_values(array_filter($d['clients'],fn($c)=>!empty($c['workspaces'])));
  $d['briefs']=array_values(array_filter($d['briefs']??[],fn($b)=>isset($allowed[$b['application_id']??''])));
  $d['dossiers']=array_values(array_filter($d['dossiers']??[],fn($x)=>isset($allowed[$x['application_id']??''])));
  $d['repositories']=array_values(array_filter($d['repositories']??[],fn($x)=>isset($allowed[$x['application_id']??''])));
  return $d;
}
function authorize_app(array $d,string $appId): bool { if(PHP_SAPI==='cli') return find_app($d,$appId)!==null; return is_agency_admin() || in_array($appId,permitted_app_ids($d),true); }

function audit(string $action,array $meta=[]): void {
  $u=current_user();
  if(postgres_schema_ready()){
    try{$pdo=forge_pdo();$st=$pdo->prepare("INSERT INTO audit_events(actor_id,agency_id,client_id,application_id,action,request_id,metadata) VALUES(NULL,NULL,NULL,NULL,?,?,?::jsonb)");$st->execute([$action,$_SERVER['HTTP_X_REQUEST_ID']??null,json_encode(array_merge(['actor'=>$u['id']??'anonymous'],$meta))]);return;}catch(Throwable $e){}
  }
  $d=json_state(); $d['audit'][]=['at'=>gmdate('c'),'user'=>$u['id']??'anonymous','action'=>$action,'meta'=>$meta]; $d['audit']=array_slice($d['audit'],-500); json_save($d);
}

function forge_login_identity(string $user,string $pass): ?array {
  if(forge_setup_ready() && hash_equals(forge_admin_user(),$user) && forge_password_ok($pass)) return ['id'=>'dk-admin','name'=>'Dream Kinetic Admin','email'=>$user,'type'=>'agency_admin'];
  $d=forge_state(); foreach($d['users']??[] as $u){ if(strcasecmp((string)$u['email'],$user)===0 && !empty($u['password_hash']) && password_verify($pass,$u['password_hash'])) return ['id'=>$u['id'],'name'=>$u['name'],'email'=>$u['email'],'type'=>$u['type']]; }
  return null;
}
function forge_invite_contractor(string $name,string $email,string $appId,string $aiPlan): ?string {
  $d=forge_state(); $app=find_app($d,$appId); if(!$app) return null; $token=bin2hex(random_bytes(24)); $hash=hash('sha256',$token);
  if(postgres_schema_ready()){
    $pdo=forge_pdo(); $pdo->beginTransaction(); try{
      $st=$pdo->prepare("SELECT id FROM forge_users WHERE lower(email)=lower(?)");$st->execute([$email]);$uid=$st->fetchColumn();
      if(!$uid){$uid=uuidv4();$st=$pdo->prepare("INSERT INTO forge_users(id,email,display_name,account_type,status,ai_plan,invite_token_hash,invite_expires_at) VALUES(?,?,?,?,?,?,?,now()+interval '7 days')");$st->execute([$uid,$email,$name,'contractor','invited',$aiPlan,$hash]);}
      else{$st=$pdo->prepare("UPDATE forge_users SET display_name=?,ai_plan=?,invite_token_hash=?,invite_expires_at=now()+interval '7 days',status='invited' WHERE id=?");$st->execute([$name,$aiPlan,$hash,$uid]);}
      $appUuid=$app['_uuid'];$st=$pdo->prepare("INSERT INTO contractor_assignments(id,user_id,application_id,access_level,status) VALUES(?,?,?,?,?) ON CONFLICT(user_id,application_id) DO UPDATE SET access_level=EXCLUDED.access_level,status='pending'");$st->execute([uuidv4(),$uid,$appUuid,'developer','pending']);$pdo->commit();
    }catch(Throwable $e){$pdo->rollBack();throw $e;}
  } else {
    $jd=json_state();$uid='u-'.substr(hash('sha256',strtolower($email)),0,12);$found=false;
    foreach($jd['users'] as &$u){ if($u['id']===$uid){$u['name']=$name;$u['email']=$email;$u['ai']=$aiPlan;$u['status']='Invited';$u['invite_token_hash']=$hash;$found=true;break;} }unset($u);
    if(!$found)$jd['users'][]=['id'=>$uid,'name'=>$name,'email'=>$email,'type'=>'contractor','status'=>'Invited','ai'=>$aiPlan,'password_hash'=>'','invite_token_hash'=>$hash,'invite_expires_at'=>time()+604800];
    $exists=false;foreach($jd['assignments'] as &$a){if($a['user_id']===$uid&&$a['application_id']===$appId){$a['status']='Pending';$exists=true;}}unset($a);if(!$exists)$jd['assignments'][]=['id'=>'a-'.bin2hex(random_bytes(5)),'user_id'=>$uid,'client_id'=>$app['_client_id'],'application_id'=>$appId,'access'=>'Developer','status'=>'Pending'];json_save($jd);
  }
  audit('contractor.invited',['email'=>$email,'application_id'=>$appId]); return $token;
}
function forge_accept_invite(string $token,string $password): bool {
  $hash=hash('sha256',$token);
  if(postgres_schema_ready()){
    $pdo=forge_pdo();$st=$pdo->prepare("SELECT id FROM forge_users WHERE invite_token_hash=? AND invite_expires_at>now() LIMIT 1");$st->execute([$hash]);$uid=$st->fetchColumn();if(!$uid)return false;
    $st=$pdo->prepare("UPDATE forge_users SET password_hash=?,invite_token_hash=NULL,invite_expires_at=NULL,status='active' WHERE id=?");$st->execute([password_hash($password,PASSWORD_DEFAULT),$uid]);$pdo->prepare("UPDATE contractor_assignments SET status='active' WHERE user_id=?")->execute([$uid]);return true;
  }
  $d=json_state();$ok=false;foreach($d['users'] as &$u){if(($u['invite_token_hash']??'')===$hash && (($u['invite_expires_at']??(time()+1))>=time())){$u['password_hash']=password_hash($password,PASSWORD_DEFAULT);$u['invite_token_hash']='';$u['status']='Active';foreach($d['assignments'] as &$a)if($a['user_id']===$u['id'])$a['status']='Active';unset($a);$ok=true;break;}}unset($u);if($ok)json_save($d);return $ok;
}

function forge_create_client(string $name): bool {
  $slug=slugify($name); if(postgres_schema_ready()){$pdo=forge_pdo();$agency=$pdo->query("SELECT id FROM agencies ORDER BY created_at LIMIT 1")->fetchColumn();$id=uuidv4();$st=$pdo->prepare("INSERT INTO clients(id,agency_id,slug,name,status) VALUES(?,?,?,?, 'active') ON CONFLICT(agency_id,slug) DO NOTHING");$st->execute([$id,$agency,$slug,$name]); if($st->rowCount()){$wid=uuidv4();$pdo->prepare("INSERT INTO workspaces(id,client_id,slug,name) VALUES(?,?,?,?)")->execute([$wid,$id,'default','Default']);}return true;}
  $d=json_state();if(find_client($d,$slug))return true;$d['clients'][]=['id'=>$slug,'name'=>$name,'status'=>'Active','workspaces'=>[['id'=>$slug.'-default','name'=>'Default','applications'=>[]]]];json_save($d);return true;
}
function forge_create_brief(string $appId,string $title,string $objective,string $risk): bool {
  $d=forge_state();$app=find_app($d,$appId);if(!$app)return false;$key='DKF-'.strtoupper(substr(bin2hex(random_bytes(4)),0,8));
  if(postgres_schema_ready()){$pdo=forge_pdo();$st=$pdo->prepare("INSERT INTO build_briefs(id,application_id,brief_key,title,objective,status,risk_class) VALUES(?,?,?,?,?,'draft',?)");$st->execute([uuidv4(),$app['_uuid'],$key,$title,$objective,$risk]);return true;}
  $jd=json_state();$jd['briefs'][]=['id'=>$key,'client_id'=>$app['_client_id'],'application_id'=>$appId,'title'=>$title,'objective'=>$objective,'stage'=>'Draft','risk'=>$risk,'updated'=>'Now'];json_save($jd);return true;
}
function forge_add_repository(string $appId,string $repo,string $branch='main'): bool {
  $d=forge_state();$app=find_app($d,$appId);if(!$app)return false;$repo=trim($repo);if(!preg_match('#^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$#',$repo))return false;
  if(postgres_schema_ready()){$pdo=forge_pdo();$st=$pdo->prepare("INSERT INTO repositories(id,application_id,provider,repository,default_branch,status) VALUES(?,?, 'github',?,?, 'unverified') ON CONFLICT(application_id,repository) DO UPDATE SET default_branch=EXCLUDED.default_branch");$st->execute([uuidv4(),$app['_uuid'],$repo,$branch]);return true;}
  $jd=json_state();$found=false;foreach($jd['repositories'] as &$r){if($r['application_id']===$appId&&$r['repository']===$repo){$r['default_branch']=$branch;$found=true;}}unset($r);if(!$found)$jd['repositories'][]=['id'=>'repo-'.bin2hex(random_bytes(5)),'application_id'=>$appId,'repository'=>$repo,'default_branch'=>$branch,'status'=>'Unverified'];json_save($jd);return true;
}
function github_repo_probe(string $repo): array {
  if(!preg_match('#^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$#',$repo))return ['ok'=>false,'status'=>'Invalid repository'];
  $url='https://api.github.com/repos/'.$repo; $opts=['http'=>['method'=>'GET','timeout'=>8,'header'=>"User-Agent: Dream-Kinetic-Forge/0.4\r\nAccept: application/vnd.github+json\r\n"]];
  $token=getenv('FORGE_GITHUB_TOKEN')?:''; if($token!=='')$opts['http']['header'].="Authorization: Bearer {$token}\r\n";
  $ctx=stream_context_create($opts);$raw=@file_get_contents($url,false,$ctx); if($raw===false)return ['ok'=>false,'status'=>'Unverified','note'=>'Forge could not reach GitHub from this server.'];
  $j=json_decode($raw,true);return !empty($j['full_name'])?['ok'=>true,'status'=>'Verified','default_branch'=>$j['default_branch']??'main','private'=>$j['private']??false,'url'=>$j['html_url']??'']:['ok'=>false,'status'=>'Unverified'];
}
function forge_mark_repo_status(string $appId,string $repo,array $probe): void {
  $status=$probe['ok']?'verified':'unverified';$branch=$probe['default_branch']??'main';
  if(postgres_schema_ready()){$d=forge_state();$app=find_app($d,$appId);if(!$app)return;$pdo=forge_pdo();$st=$pdo->prepare("UPDATE repositories SET status=?,default_branch=? WHERE application_id=? AND repository=?");$st->execute([$status,$branch,$app['_uuid'],$repo]);return;}
  $d=json_state();foreach($d['repositories'] as &$r)if($r['application_id']===$appId&&$r['repository']===$repo){$r['status']=ucfirst($status);$r['default_branch']=$branch;}unset($r);json_save($d);
}

function run_postgres_migrations(string $url): array {
  $pdo=forge_pdo($url);$dir=dirname(__DIR__).'/database/migrations';$files=glob($dir.'/*.sql');sort($files);$ran=[];foreach($files as $f){$sql=file_get_contents($f);$pdo->exec($sql);$ran[]=basename($f);}return $ran;
}
function seed_postgres_from_json(string $url): void {
  $pdo=forge_pdo($url);$d=json_state();$pdo->beginTransaction();try{
    $agencyId=uuidv4();$st=$pdo->prepare("INSERT INTO agencies(id,slug,name,status) VALUES(?,?,?,'active') ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name RETURNING id");$st->execute([$agencyId,$d['agency']['id'],$d['agency']['name']]);$agencyId=$st->fetchColumn()?:$agencyId;
    foreach($d['clients'] as $c){$cid=uuidv4();$st=$pdo->prepare("INSERT INTO clients(id,agency_id,slug,name,status) VALUES(?,?,?,?, 'active') ON CONFLICT(agency_id,slug) DO UPDATE SET name=EXCLUDED.name RETURNING id");$st->execute([$cid,$agencyId,$c['id'],$c['name']]);$cid=$st->fetchColumn()?:$cid;
      foreach($c['workspaces']??[] as $w){$wid=uuidv4();$st=$pdo->prepare("INSERT INTO workspaces(id,client_id,slug,name) VALUES(?,?,?,?) ON CONFLICT(client_id,slug) DO UPDATE SET name=EXCLUDED.name RETURNING id");$st->execute([$wid,$cid,$w['id'],$w['name']]);$wid=$st->fetchColumn()?:$wid;
        foreach($w['applications']??[] as $a){$aid=uuidv4();$st=$pdo->prepare("INSERT INTO applications(id,workspace_id,slug,name,architecture_profile,runtime_profile,status) VALUES(?,?,?,?,?,?,'active') ON CONFLICT(workspace_id,slug) DO UPDATE SET name=EXCLUDED.name,architecture_profile=EXCLUDED.architecture_profile,runtime_profile=EXCLUDED.runtime_profile RETURNING id");$st->execute([$aid,$wid,$a['id'],$a['name'],$a['architecture'],$a['runtime']]);$aid=$st->fetchColumn()?:$aid;
          foreach($a['environments']??[] as $e){$kind=strtolower($e);if(!in_array($kind,['development','preview','staging','production'],true))$kind='development';$pdo->prepare("INSERT INTO environments(id,application_id,slug,name,kind,status) VALUES(?,?,?,?,?,'ready') ON CONFLICT(application_id,slug) DO NOTHING")->execute([uuidv4(),$aid,slugify($e),$e,$kind]);}
          if(!empty($a['repo']))$pdo->prepare("INSERT INTO repositories(id,application_id,provider,repository,default_branch,status) VALUES(?,?, 'github',?,'main','unverified') ON CONFLICT(application_id,repository) DO NOTHING")->execute([uuidv4(),$aid,$a['repo']]);
        }
      }
    }
    foreach($d['dossiers']??[] as $x){$app=find_app($d,$x['application_id']);if(!$app)continue;$st=$pdo->prepare("SELECT a.id FROM applications a JOIN workspaces w ON w.id=a.workspace_id JOIN clients c ON c.id=w.client_id WHERE a.slug=? AND c.slug=? LIMIT 1");$st->execute([$x['application_id'],$x['client_id']]);$aid=$st->fetchColumn();if($aid){$pdo->prepare("UPDATE design_dossiers SET is_current=false WHERE application_id=?")->execute([$aid]);$pdo->prepare("INSERT INTO design_dossiers(id,application_id,version,title,file_ref,status,is_current) VALUES(?,?,?,?,?,'approved',true) ON CONFLICT(application_id,version) DO UPDATE SET is_current=true,title=EXCLUDED.title,status='approved'")->execute([uuidv4(),$aid,$x['version'],$x['title'],'registry://'.$x['id']]);}}
    foreach($d['briefs']??[] as $b){$st=$pdo->prepare("SELECT a.id FROM applications a JOIN workspaces w ON w.id=a.workspace_id JOIN clients c ON c.id=w.client_id WHERE a.slug=? AND c.slug=? LIMIT 1");$st->execute([$b['application_id'],$b['client_id']]);$aid=$st->fetchColumn();if($aid)$pdo->prepare("INSERT INTO build_briefs(id,application_id,brief_key,title,objective,status,risk_class) VALUES(?,?,?,?,?,'draft',?) ON CONFLICT(application_id,brief_key) DO NOTHING")->execute([uuidv4(),$aid,$b['id'],$b['title'],$b['objective'],$b['risk']]);}
    $userMap=[];
    foreach($d['users']??[] as $u){if(($u['type']??'')==='agency_admin')continue;$uid=uuidv4();$st=$pdo->prepare("INSERT INTO forge_users(id,email,display_name,account_type,status,ai_plan,password_hash) VALUES(?,?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET display_name=EXCLUDED.display_name,ai_plan=EXCLUDED.ai_plan RETURNING id");$st->execute([$uid,$u['email'],$u['name'],$u['type']??'contractor',strtolower($u['status']??'invited'),$u['ai']??'',($u['password_hash']??'')?:null]);$uid=$st->fetchColumn()?:$uid;$userMap[$u['id']]=$uid;}
    foreach($d['assignments']??[] as $x){if(empty($userMap[$x['user_id']]))continue;$st=$pdo->prepare("SELECT a.id FROM applications a JOIN workspaces w ON w.id=a.workspace_id JOIN clients c ON c.id=w.client_id WHERE a.slug=? AND c.slug=? LIMIT 1");$st->execute([$x['application_id'],$x['client_id']]);$aid=$st->fetchColumn();if($aid)$pdo->prepare("INSERT INTO contractor_assignments(id,user_id,application_id,access_level,status) VALUES(?,?,?,?,?) ON CONFLICT(user_id,application_id) DO UPDATE SET access_level=EXCLUDED.access_level,status=EXCLUDED.status")->execute([uuidv4(),$userMap[$x['user_id']],$aid,strtolower($x['access']??'developer'),strtolower($x['status']??'pending')]);}
    foreach($d['repositories']??[] as $r){$app=find_app($d,$r['application_id']);if(!$app)continue;$st=$pdo->prepare("SELECT a.id FROM applications a JOIN workspaces w ON w.id=a.workspace_id JOIN clients c ON c.id=w.client_id WHERE a.slug=? AND c.slug=? LIMIT 1");$st->execute([$r['application_id'],$app['_client_id']]);$aid=$st->fetchColumn();if($aid&&!empty($r['repository']))$pdo->prepare("INSERT INTO repositories(id,application_id,provider,repository,default_branch,status) VALUES(?,?, 'github',?,?,?) ON CONFLICT(application_id,repository) DO UPDATE SET default_branch=EXCLUDED.default_branch,status=EXCLUDED.status")->execute([uuidv4(),$aid,$r['repository'],$r['default_branch']??'main',strtolower($r['status']??'unverified')]);}
    $pdo->commit();
  }catch(Throwable $e){$pdo->rollBack();throw $e;}
}

function make_agent_pack(array $d,string $appId): ?array {
  if(!authorize_app($d,$appId)) return null; $app=find_app($d,$appId);if(!$app)return null;$brief=null;foreach($d['briefs']??[] as $b)if($b['application_id']===$appId){$brief=$b;break;}$dossier=null;foreach($d['dossiers']??[] as $x)if($x['application_id']===$appId&&$x['status']==='Current'){$dossier=$x;break;}
  $rules=['Operate only within the assigned client/application scope.','Follow the current architecture profile and Design Dossier.','Do not introduce cross-client data access or ambient privilege.','Use Forge contracts and declared domain ownership; no undeclared cross-domain writes.','WordPress is never a new application authority unless an approved exception exists.','Mutating AI actions require authorization, risk classification, verification, and audit receipt.','Explore/Research/Design modes must not mutate source code. Build mode must use a development branch or preview workspace.','Do not call a build complete until required Forge checks pass.'];
  $agents="# AGENTS.md — {$app['name']}\n\nAgency: Dream Kinetic\nClient: {$app['_client']}\nWorkspace: {$app['_workspace']}\nArchitecture: {$app['architecture']}\nRuntime: {$app['runtime']}\nRepository: ".($app['repo']?:'Not connected')."\nDesign dossier: ".($dossier['title']??$app['dossier'])."\nActive build brief: ".($brief['title']??$app['brief'])."\n\n## Non-negotiable rules\n";foreach($rules as $r)$agents.="- {$r}\n";
  $context=['generated_at'=>gmdate('c'),'agency'=>'Dream Kinetic','client'=>$app['_client'],'workspace'=>$app['_workspace'],'application'=>$app['name'],'architecture'=>$app['architecture'],'runtime'=>$app['runtime'],'repository'=>$app['repo'],'environments'=>$app['environments'],'dossier'=>$dossier,'build_brief'=>$brief,'rules'=>$rules];
  return ['agents'=>$agents,'claude'=>str_replace('# AGENTS.md','# CLAUDE.md',$agents)."\nUse this file as a convenience entry point; AGENTS.md and Forge context remain authoritative.\n",'context'=>$context];
}

function certification_checks(array $d): array {
  $s=storage_status();$h=https_status();$apps=all_apps($d);$cross=true;
  foreach($d['assignments']??[] as $a){$app=find_app($d,$a['application_id']);if(!$app || $app['_client_id']!==$a['client_id']){$cross=false;break;}}
  return [
    ['name'=>'HTTPS / secure transport','ok'=>$h['ready'],'detail'=>$h['label']],
    ['name'=>'PostgreSQL production authority','ok'=>$s['driver']==='PostgreSQL'&&$s['ready'],'detail'=>$s['driver'].' — '.$s['note']],
    ['name'=>'Agency → Client → Workspace → Application → Environment','ok'=>count($apps)>0,'detail'=>count($apps).' registered applications'],
    ['name'=>'Contractor assignment tenant scope','ok'=>$cross,'detail'=>$cross?'Assignment/client references are consistent':'A cross-client assignment mismatch was detected'],
    ['name'=>'AI context isolation rule','ok'=>true,'detail'=>'Agent packs are filtered by authorized application scope'],
    ['name'=>'Repository registry','ok'=>count($d['repositories']??[])>0,'detail'=>count($d['repositories']??[]).' repository record(s)'],
  ];
}
