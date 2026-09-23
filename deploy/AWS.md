# Deploying to AWS EC2

One small ARM instance in São Paulo, supervised by systemd. Everything is done
once in the AWS console; after that, updates are a single command.

| Setting | Value |
|---------|-------|
| Region | `sa-east-1` — South America (São Paulo), close to the account's usual location |
| Instance | `t4g.micro` (ARM, 2 vCPU, 1 GB) + 2 GB swap (created by `setup.sh`) |
| OS | Ubuntu Server 24.04 LTS, 64-bit (Arm) |
| Disk | 8 GiB gp3 |
| Inbound | SSH (22) from your IP only — the bot needs no inbound ports |
| Backups | Daily EBS snapshots, keep 7 (Lifecycle Manager) |

Console labels below may drift slightly as AWS updates its UI.

---

## 1. SSH key (on your machine)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/wa-monitor -C wa-monitor
cat ~/.ssh/wa-monitor.pub      # paste this in step 2
```

## 2. Console setup

Select **South America (São Paulo)** in the region picker (top right) before
anything else — resources are per region.

1. **Import the key** — EC2 → *Key Pairs* → *Actions* → *Import key pair*.
   Name `wa-monitor`, paste the public key.
2. **Launch the instance** — EC2 → *Launch instance*:
   - Name: `wa-monitor`
   - AMI: *Ubuntu Server 24.04 LTS*, architecture **64-bit (Arm)**
   - Instance type: **t4g.micro**
   - Key pair: `wa-monitor`
   - Network settings: *Create security group*, **Allow SSH traffic from → My IP**.
     Leave HTTP/HTTPS unchecked.
   - Storage: 8 GiB **gp3**
   - *Advanced details* → *Termination protection*: **Enable** (optional, recommended)
   - *Launch instance*
3. **Elastic IP** (stable address) — EC2 → *Elastic IPs* → *Allocate Elastic IP
   address* → *Allocate*; then *Actions* → *Associate Elastic IP address* →
   select the `wa-monitor` instance → *Associate*. Note the IP.
4. **Daily snapshots** — EC2 → *Lifecycle Manager* → *Create lifecycle policy*:
   - *EBS snapshot policy* → target resource type **Instance**, target tag
     `Name` = `wa-monitor`
   - IAM role: *Default role*
   - Schedule: every **24 hours**, retention **7** snapshots → *Create policy*
5. **Budget alert** (optional, recommended) — *Billing and Cost Management* →
   *Budgets* → *Create budget* → *Monthly cost budget*, e.g. $15, with your email.

## 3. SSH alias (on your machine)

Add to `~/.ssh/config` (replace the IP):

```
Host wa-monitor
  HostName <ELASTIC_IP>
  User ubuntu
  IdentityFile ~/.ssh/wa-monitor
  IdentitiesOnly yes
```

Test: `ssh wa-monitor 'uname -m'` → `aarch64`.

> If your home IP changes, SSH will time out: update the security group's SSH
> rule (EC2 → *Security Groups* → edit inbound → *My IP*).

## 4. Server setup

```bash
ssh wa-monitor 'curl -fsSL https://raw.githubusercontent.com/MarlonBuosi/keyword-sniffer/main/deploy/setup.sh -o /tmp/setup.sh && sudo bash /tmp/setup.sh'
```

Copy the config over. On the server, state lives in `/var/lib/wa-monitor/`
(`config.json` + `auth_state/`), separate from the code in `/opt/wa-monitor/`.
The config is owned by the service user, since DM commands rewrite it:

```bash
scp config.json wa-monitor:/tmp/config.json
ssh wa-monitor 'sudo install -o wa -g wa -m 600 /tmp/config.json /var/lib/wa-monitor/config.json && rm /tmp/config.json'
```

## 5. Pair the bot number

```bash
ssh wa-monitor
sudo sed -i 's/^#\?PAIR_PHONE=.*/PAIR_PHONE=55XXXXXXXXXXX/' /etc/wa-monitor.env   # bot number, digits only
sudo systemctl start wa-monitor
journalctl -u wa-monitor -f -o cat | grep --line-buffered -E 'PAIRING CODE|connection'
```

On the **bot** phone: WhatsApp → *Linked Devices* → *Link a Device* → *Link with
phone number instead* → type the 8-character code. A `connection closed` with
515 right after is expected; it reconnects and logs `connection open`.

Then remove the pairing number (it's ignored once paired, but keep things tidy):

```bash
sudo sed -i 's/^PAIR_PHONE=/#PAIR_PHONE=/' /etc/wa-monitor.env
```

If the code expires before you type it, the bot reconnects and logs a new one.

## 6. Verify

```bash
systemctl status wa-monitor                   # active (running)
journalctl -u wa-monitor -o cat -n 50 | /opt/wa-monitor/node_modules/.bin/pino-pretty
```

- Logs show `connection open` and one `monitoring group` line per group.
- DM `list keywords` to the bot from the owner number → it replies.
- `sudo reboot`, wait a minute → `systemctl status wa-monitor` is active again.

## 7. Automatic deploys

Merges to `main` deploy themselves: CI job `quality` → job `deploy`, which
logs in to AWS with GitHub's OIDC token (no stored keys) and runs the SSM
document `wa-monitor-deploy` → `deploy/update.sh <sha>` on the instance. The
GitHub role can do nothing else: only that document, only on this instance,
only from `main` of this repo.

All in the **São Paulo** region, in this order:

1. **Instance role** (lets the SSM agent on the server talk to AWS) —
   IAM → *Roles* → *Create role* → *AWS service*, use case **EC2** → attach
   **`AmazonSSMManagedInstanceCore`** → name `wa-monitor-ssm` → *Create*.
   Then EC2 → select the instance → *Actions* → *Security* → *Modify IAM
   role* → `wa-monitor-ssm` → *Update*.
2. **SSM document** — Systems Manager → *Documents* → *Create document* →
   *Command or Session*. Name **`wa-monitor-deploy`**, target type
   `/AWS::EC2::Instance`, content **JSON**: paste
   [`deploy/ssm/wa-monitor-deploy.json`](ssm/wa-monitor-deploy.json) →
   *Create document*.
3. **GitHub as an identity provider** — IAM → *Identity providers* → *Add
   provider* → **OpenID Connect**; provider URL
   `https://token.actions.githubusercontent.com`, audience
   `sts.amazonaws.com` → *Add provider*.
4. **Role for GitHub** — IAM → *Roles* → *Create role* → **Web identity** →
   identity provider `token.actions.githubusercontent.com`, audience
   `sts.amazonaws.com`, GitHub organization **`MarlonBuosi`**, repository
   **`keyword-sniffer`**, branch **`main`** → *Next* → skip managed policies →
   name **`gh-deploy-wa-monitor`** → *Create role*. Open the role →
   *Add permissions* → *Create inline policy* → JSON:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "DeployOnly",
         "Effect": "Allow",
         "Action": "ssm:SendCommand",
         "Resource": [
           "arn:aws:ec2:sa-east-1:*:instance/i-0464201d495fd57a7",
           "arn:aws:ssm:sa-east-1:*:document/wa-monitor-deploy"
         ]
       },
       {
         "Sid": "ReadResult",
         "Effect": "Allow",
         "Action": "ssm:GetCommandInvocation",
         "Resource": "*"
       }
     ]
   }
   ```
   Name it `deploy-only`.

   **Fix the trust policy.** This repo uses GitHub's *immutable* OIDC
   subject, which includes the owner and repo IDs, but the console's GitHub
   fields generate the old name-only form, so logins fail with
   `Not authorized to perform sts:AssumeRoleWithWebIdentity`. Check the
   format with
   `gh api repos/MarlonBuosi/keyword-sniffer/actions/oidc/customization/sub`
   (`sub_claim_prefix`), then *Trust relationships* → *Edit trust policy*:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Principal": {
           "Federated": "arn:aws:iam::<account>:oidc-provider/token.actions.githubusercontent.com"
         },
         "Action": "sts:AssumeRoleWithWebIdentity",
         "Condition": {
           "StringEquals": {
             "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
             "token.actions.githubusercontent.com:sub": "repo:MarlonBuosi@42485196/keyword-sniffer@1303178364:ref:refs/heads/main"
           }
         }
       }
     ]
   }
   ```
   Pinning IDs is also safer: a re-created repo with the same name gets a
   new ID and can't use this role. Copy the role **ARN**.
5. **Repo variables** (not secrets — nothing here is sensitive):
   ```bash
   gh variable set AWS_DEPLOY_ROLE_ARN --body 'arn:aws:iam::<account>:role/gh-deploy-wa-monitor'
   gh variable set EC2_INSTANCE_ID --body 'i-0464201d495fd57a7'
   ```

Check: the instance shows as *Online* under Systems Manager → *Fleet
Manager* (a few minutes after step 1; `sudo snap restart amazon-ssm-agent`
speeds it up). Then *Actions* → *CI* → *Run workflow* on `main`.

## Day-to-day

| Task | Command |
|------|---------|
| Deploy | Merge to `main` (automatic, §7), or *Actions → CI → Run workflow* |
| Deploy manually | `ssh wa-monitor 'sudo /opt/wa-monitor/deploy/update.sh'` (latest `main`) |
| Roll back | `ssh wa-monitor 'sudo /opt/wa-monitor/deploy/update.sh <older-main-sha>'` |
| Live logs | `ssh wa-monitor "journalctl -u wa-monitor -f -o cat \| /opt/wa-monitor/node_modules/.bin/pino-pretty"` |
| Restart / stop | `ssh wa-monitor 'sudo systemctl restart wa-monitor'` (or `stop`) |
| Edit keywords | DM the bot, or `sudo -u wa nano /var/lib/wa-monitor/config.json` (hot-reloaded) |
| OS updates | `ssh wa-monitor 'sudo apt-get update && sudo apt-get -y upgrade'` (Ubuntu also installs security updates automatically) |

**`failed` with `status=2`** means WhatsApp rejected the session (logged out /
banned). systemd deliberately doesn't restart it. Re-pair:
`sudo systemctl stop wa-monitor && sudo find /var/lib/wa-monitor/auth_state -mindepth 1 -delete`,
then repeat step 5.

**Restoring from a snapshot:** EC2 → *Snapshots* → pick one → *Create volume*
(same availability zone) → stop the instance, detach the old root volume,
attach the new one as `/dev/sda1`, start.
