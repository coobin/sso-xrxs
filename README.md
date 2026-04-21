# SSO XRXS

`SSO XRXS` 是一个轻量级单点登录网关，用来把已有认证系统接入薪人薪事的免登接口。

它适合这样的场景：

- 已经有统一认证入口，例如 Authelia、OAuth 网关或自研认证系统
- 反向代理可以把认证后的用户身份通过 HTTP Header 转发给后端
- 希望用户访问一个内部入口域名后，自动跳转并登录薪人薪事

## 功能特性

- 支持 `Authelia + Nginx` 或 `Authelia + Nginx Proxy Manager`
- 支持通过可信请求头读取用户身份
- 支持按邮箱、手机号、工号或薪人薪事员工 ID 定位员工
- 自动获取并缓存薪人薪事 `access_token`
- 按薪人薪事 OpenAPI v5 签名规则生成请求签名
- Docker / Docker Compose 部署
- 提供健康检查和调试接口，便于上线联调

## 工作流程

默认推荐使用 `trusted_headers` 模式：

1. 用户访问你的薪人薪事 SSO 入口，例如 `https://xrxs.example.com`
2. 反向代理先将请求交给 Authelia 或其他认证系统校验
3. 认证通过后，反向代理把 `Remote-Email`、`Remote-User` 等身份头转发给本服务
4. 本服务按配置解析用户身份
5. 如果没有直接传入薪人薪事 `employeeId`，本服务会调用 `/v5/employee/getId` 查询员工 ID
6. 本服务调用 `/v5/login/geturl` 获取薪人薪事免登 URL
7. 浏览器被 `302` 跳转到薪人薪事并完成登录

## 薪人薪事接口

本项目使用以下薪人薪事 OpenAPI：

- 获取凭证令牌：
  `POST https://api.xinrenxinshi.com/authorize/oauth/token`
- 查询员工 ID：
  `POST https://api.xinrenxinshi.com/v5/employee/getId`
- 获取免登 URL：
  `POST https://api.xinrenxinshi.com/v5/login/geturl`

签名规则：

1. 将请求体 JSON 字符串作为签名明文
2. 使用 `appSecret` 做 `HmacSHA1`
3. 对结果做 `Base64`
4. 再做 URL encode，作为查询参数 `sign`

## 快速开始

复制配置：

```bash
cp .env.example .env
```

修改 `.env`，至少需要配置：

```env
APP_BASE_URL=https://xrxs.example.com
COOKIE_DOMAIN=xrxs.example.com
SESSION_SECRET=replace-with-a-long-random-string

XRXS_APP_KEY=replace-with-xrxs-app-key
XRXS_APP_SECRET=replace-with-xrxs-app-secret
XRXS_EMPLOYEE_LOOKUP_TYPE=email
```

启动服务：

```bash
docker compose up -d --build
```

默认服务端口为 `3001`。如果你希望只允许本机反向代理访问，可以将 `docker-compose.yml` 中的端口映射改成：

```yaml
ports:
  - "127.0.0.1:3001:3001"
```

如果 Nginx Proxy Manager 在其他容器网络或其他机器上访问本服务，可以使用：

```yaml
ports:
  - "3001:3001"
```

## 环境变量

基础配置：

- `PORT`
  服务监听端口，默认 `3001`
- `APP_BASE_URL`
  服务对外访问地址，例如 `https://xrxs.example.com`
- `SESSION_SECRET`
  本地会话 Cookie 签名密钥，请使用随机长字符串
- `COOKIE_SECURE`
  是否给 Cookie 加 `Secure` 标记，HTTPS 场景建议为 `true`
- `COOKIE_DOMAIN`
  Cookie 域名，例如 `xrxs.example.com`

认证配置：

- `AUTH_MODE`
  可选 `trusted_headers` 或 `exchange_code`
- `REMOTE_USER_HEADER`
  用户 ID 请求头，默认 `Remote-User`
- `REMOTE_EMAIL_HEADER`
  邮箱请求头，默认 `Remote-Email`
- `REMOTE_NAME_HEADER`
  姓名请求头，默认 `Remote-Name`
- `REMOTE_EMPLOYEE_ID_HEADER`
  薪人薪事员工 ID 请求头，默认 `Remote-Employee-Id`
- `REMOTE_MOBILE_HEADER`
  手机号请求头，默认 `Remote-Mobile`
- `REMOTE_JOB_NUMBER_HEADER`
  工号请求头，默认 `Remote-Job-Number`

薪人薪事配置：

- `XRXS_APP_KEY`
  薪人薪事开放平台应用 `appKey`
- `XRXS_APP_SECRET`
  薪人薪事开放平台应用 `appSecret`
- `XRXS_EMPLOYEE_LOOKUP_TYPE`
  员工定位方式，可选 `auto`、`employee_id`、`email`、`mobile`、`job_number`
- `XRXS_EMPLOYEE_STATUS`
  查询员工状态，默认 `0`
- `XRXS_REDIRECT_TYPE`
  免登端类型，`0=PC`，`1=H5`
- `XRXS_USER_TYPE`
  免登用户类型，`0=员工免登`，`1=管理员免登`，`2=管理员优先免登`
- `XRXS_REDIRECT_URL_TYPE`
  薪人薪事跳转目标类型，可按官方文档配置
- `XRXS_REDIRECT_PARAM_JSON`
  跳转目标参数，JSON 对象字符串

## 路由说明

- `GET /`
  主入口。已认证则跳转到 `/sso/xrxs`
- `GET /sso/xrxs`
  解析用户身份，调用薪人薪事免登接口，并跳转到薪人薪事返回的 URL
- `GET /debug/session`
  查看当前请求是否识别到登录用户
- `GET /debug/resolve`
  查看当前登录用户最终解析出的薪人薪事员工 ID
- `GET /healthz`
  健康检查
- `GET /logout`
  清理本地会话 Cookie

## Authelia + Nginx

如果使用 Authelia，推荐使用 `trusted_headers` 模式。

示例配置：

```nginx
location / {
    auth_request /authelia;
    auth_request_set $target_url $scheme://$http_host$request_uri;
    auth_request_set $user $upstream_http_remote_user;
    auth_request_set $name $upstream_http_remote_name;
    auth_request_set $email $upstream_http_remote_email;

    auth_request_set $employee_id $upstream_http_remote_employee_id;
    auth_request_set $mobile $upstream_http_remote_mobile;
    auth_request_set $job_number $upstream_http_remote_job_number;

    error_page 401 =302 https://auth.example.com?rd=$target_url;

    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_set_header Remote-User $user;
    proxy_set_header Remote-Name $name;
    proxy_set_header Remote-Email $email;
    proxy_set_header Remote-Employee-Id $employee_id;
    proxy_set_header Remote-Mobile $mobile;
    proxy_set_header Remote-Job-Number $job_number;
}

location /authelia {
    internal;
    proxy_pass http://authelia:9091/api/verify;
    proxy_set_header Host $http_host;
    proxy_set_header X-Original-URL $scheme://$http_host$request_uri;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Content-Length "";
    proxy_pass_request_body off;
}
```

注意：

- 如果 Nginx 不能解析 `authelia` 这个主机名，请把 `proxy_pass http://authelia:9091/api/verify` 改成实际可访问的 Authelia 地址
- 如果 Nginx Proxy Manager 和本服务不在同一个 Docker 网络，请确保本服务端口对 NPM 可达
- 推荐优先使用 `XRXS_EMPLOYEE_LOOKUP_TYPE=email`，前提是 Authelia 能稳定传递 `Remote-Email`

仓库中还提供了可直接修改的样板：

- `deploy/nginx.xrxs.conf`
- `deploy/npm-advanced.conf`
- `.env.authelia.example`

## Nginx Proxy Manager

新建 Proxy Host：

- Domain Names：`xrxs.example.com`
- Scheme：`http`
- Forward Hostname / IP：本服务 IP，例如 `127.0.0.1` 或 `10.0.0.10`
- Forward Port：`3001`
- SSL：按需申请 Let's Encrypt 证书

Advanced 中可以参考 `deploy/npm-advanced.conf`。

如果保存后显示 `Offline`，常见原因有：

- NPM 访问不到本服务的 `3001` 端口
- Advanced 配置中的 Authelia 地址无法解析
- `proxy_pass` 写成了 NPM 所在网络无法访问的地址
- Nginx 配置语法错误导致该 Proxy Host 未能加载

## 联调顺序

建议按这个顺序排查：

1. 测服务健康检查：

```bash
curl http://127.0.0.1:3001/healthz
```

2. 测反向代理健康检查：

```text
https://xrxs.example.com/healthz
```

3. 登录后访问：

```text
https://xrxs.example.com/debug/session
```

确认能看到 `authenticated: true` 和用户邮箱。

4. 解析薪人薪事员工：

```text
https://xrxs.example.com/debug/resolve
```

5. 最终访问入口：

```text
https://xrxs.example.com/
```

## 常见问题

`/debug/session` 未识别到用户：

- 检查 Authelia 是否已经认证通过
- 检查 Nginx 是否转发了 `Remote-Email`
- 检查 `REMOTE_EMAIL_HEADER` 是否和实际请求头一致

`/debug/resolve` 返回没有员工：

- 检查 `XRXS_EMPLOYEE_LOOKUP_TYPE`
- 检查薪人薪事中是否存在该邮箱、手机号、工号或员工 ID
- 检查应用是否有 `/v5/employee/getId` 权限

访问 `/sso/xrxs` 提示没有权限：

- 检查薪人薪事开放平台应用是否有 `/v5/login/geturl` 权限
- 检查 `XRXS_USER_TYPE` 是否和应用授权范围一致
- 检查该员工是否有薪人薪事账号及对应登录权限

Docker 拉取镜像失败：

- 检查服务器能否访问 Docker Hub
- 按需配置 Docker 代理或 `registry-mirrors`
- 也可以在其他机器拉取 `node:20-alpine` 后使用 `docker save` / `docker load` 导入

## 安全建议

- 不要将真实 `.env` 提交到 GitHub
- `SESSION_SECRET` 请使用随机长字符串
- `XRXS_APP_SECRET` 属于敏感凭据，应妥善保管
- 如果不需要对外暴露服务端口，建议只绑定到 `127.0.0.1`
- 生产环境建议限制 `/debug/*` 的访问来源，或在联调完成后通过反向代理限制访问

## 参考文档

- [薪人薪事鉴权认证](https://api.xinrenxinshi.com/doc/v3/page/guide/authentication.html)
- [薪人薪事签名规则](https://api.xinrenxinshi.com/doc/v3/page/guide/signatureRule_v5.html)
- [薪人薪事获取员工 ID](https://api.xinrenxinshi.com/doc/v3/page/employee/getEmployeeID_v5.html)
- [薪人薪事获取免登 URL](https://api.xinrenxinshi.com/doc/v3/page/free/login_v5.html)

## License

MIT
