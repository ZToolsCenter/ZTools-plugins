// src/Containers/shellCommands.ts
// 常用镜像的容器内命令模板 + 通用命令；用于终端一键执行

// 按镜像 basename 的常用命令（进入容器后常用诊断/操作）
export const IMAGE_COMMANDS: Record<string, string[]> = {
  mysql: ['mysql -u root -p', 'SHOW DATABASES;', 'cat /etc/mysql/my.cnf', 'SHOW PROCESSLIST;'],
  mariadb: ['mysql -u root -p', 'SHOW DATABASES;'],
  postgres: ['psql -U postgres', '\\l', '\\dt', 'SELECT version();'],
  redis: ['redis-cli', 'INFO server', 'KEYS *', 'DBSIZE'],
  nginx: ['nginx -t', 'ls /etc/nginx/conf.d/', 'cat /etc/nginx/nginx.conf'],
  mongo: ['mongosh', 'show dbs'],
  mongodb: ['mongosh', 'show dbs'],
  elasticsearch: ['curl -s localhost:9200/_cat/indices', 'curl -s localhost:9200/_cluster/health'],
  rabbitmq: ['rabbitmqctl status', 'rabbitmqctl list_queues'],
  kafka: ['kafka-topics.sh --list --bootstrap-server localhost:9092'],
  grafana: ['ls /etc/grafana', 'cat /etc/grafana/grafana.ini'],
  prometheus: ['cat /etc/prometheus/prometheus.yml'],
  tomcat: ['ls /usr/local/tomcat/conf', 'cat /usr/local/tomcat/conf/server.xml'],
  clickhouse: ['clickhouse-client', 'SHOW DATABASES;'],
  'clickhouse-server': ['clickhouse-client', 'SHOW DATABASES;'],
  minio: ['mc admin info local', 'ls /data'],
  jenkins: ['ls /var/jenkins_home', 'cat /var/jenkins_home/secrets/initialAdminPassword'],
  python: ['python --version', 'pip list'],
  node: ['node --version', 'npm ls --depth=0'],
  php: ['php -v', 'php -m'],
  ubuntu: ['cat /etc/os-release', 'apt list --installed | head'],
  alpine: ['cat /etc/os-release', 'apk list --installed | head'],
  debian: ['cat /etc/os-release'],
  centos: ['cat /etc/os-release', 'yum list installed | head']
}

// 任意镜像通用的诊断命令
export const COMMON_COMMANDS = [
  'ps aux',
  'ls -la',
  'env',
  'cat /etc/os-release',
  'df -h',
  'free -m',
  'du -sh ./*'
]

// 按镜像返回推荐命令（镜像专属 + 通用，去重）
export function imageCommands(image: string): string[] {
  const base = (image || '').split('/').pop()?.split(':')[0]?.toLowerCase() || ''
  const merged = [...(IMAGE_COMMANDS[base] || []), ...COMMON_COMMANDS]
  return [...new Set(merged)]
}
