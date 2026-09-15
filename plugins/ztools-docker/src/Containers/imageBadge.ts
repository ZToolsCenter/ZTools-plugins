// src/Containers/imageBadge.ts
// 容器镜像 → 品牌 LOGO（simple-icons SVG）；缺失时回退品牌色字母徽章；k8s 组件识别
import type { ContainerSummary } from '../types'
import {
  siMysql,
  siPostgresql,
  siRedis,
  siNginx,
  siMongodb,
  siElasticsearch,
  siRabbitmq,
  siApachekafka,
  siGrafana,
  siPrometheus,
  siJenkins,
  siApachetomcat,
  siPython,
  siNodedotjs,
  siOpenjdk,
  siUbuntu,
  siAlpinelinux,
  siDebian,
  siClickhouse,
  siApachecassandra,
  siInfluxdb,
  siApachecouchdb,
  siCouchbase,
  siNeo4j,
  siSqlite,
  siApachepulsar,
  siEclipsemosquitto,
  siApacherocketmq,
  siOpensearch,
  siApachesolr,
  siApache,
  siCaddy,
  siTraefikproxy,
  siEnvoyproxy,
  siKeycloak,
  siKibana,
  siLogstash,
  siFluentd,
  siVault,
  siHarbor,
  siPortainer,
  siGitlab,
  siGitea,
  siMinio,
  siEtcd,
  siNatsdotio,
  siOllama,
  siN8n,
  siConsul,
  siTimescale,
  siCockroachlabs,
  siTidb,
  siKubernetes,
  siDocker
} from 'simple-icons'
import type { SimpleIcon } from 'simple-icons'

export interface ImageBadge {
  letter: string
  bg: string
}

// 镜像名 → simple-icons 品牌 LOGO
const ICON_BY_IMAGE: Record<string, SimpleIcon> = {
  mysql: siMysql,
  postgres: siPostgresql,
  redis: siRedis,
  nginx: siNginx,
  mongo: siMongodb,
  mongodb: siMongodb,
  elasticsearch: siElasticsearch,
  rabbitmq: siRabbitmq,
  kafka: siApachekafka,
  grafana: siGrafana,
  prometheus: siPrometheus,
  jenkins: siJenkins,
  tomcat: siApachetomcat,
  python: siPython,
  node: siNodedotjs,
  openjdk: siOpenjdk,
  ubuntu: siUbuntu,
  alpine: siAlpinelinux,
  debian: siDebian,
  clickhouse: siClickhouse,
  'clickhouse-server': siClickhouse,
  cassandra: siApachecassandra,
  influxdb: siInfluxdb,
  couchdb: siApachecouchdb,
  couchbase: siCouchbase,
  neo4j: siNeo4j,
  sqlite: siSqlite,
  pulsar: siApachepulsar,
  mosquitto: siEclipsemosquitto,
  rocketmq: siApacherocketmq,
  opensearch: siOpensearch,
  solr: siApachesolr,
  apache: siApache,
  httpd: siApache,
  caddy: siCaddy,
  traefik: siTraefikproxy,
  envoy: siEnvoyproxy,
  keycloak: siKeycloak,
  kibana: siKibana,
  logstash: siLogstash,
  fluentd: siFluentd,
  vault: siVault,
  harbor: siHarbor,
  portainer: siPortainer,
  gitlab: siGitlab,
  gitea: siGitea,
  minio: siMinio,
  etcd: siEtcd,
  nats: siNatsdotio,
  ollama: siOllama,
  n8n: siN8n,
  consul: siConsul,
  timescaledb: siTimescale,
  cockroachdb: siCockroachlabs,
  tidb: siTidb
}

// 常用镜像 → 品牌色缩写徽章（回退方案，simple-icons 缺失的品牌使用）
export const IMAGE_BADGES: Record<string, ImageBadge> = {
  mysql: { letter: 'M', bg: '#00758f' },
  mariadb: { letter: 'M', bg: '#003545' },
  postgres: { letter: 'P', bg: '#336791' },
  redis: { letter: 'R', bg: '#d82c20' },
  nginx: { letter: 'N', bg: '#009639' },
  mongo: { letter: 'M', bg: '#47a248' },
  mongodb: { letter: 'M', bg: '#47a248' },
  elasticsearch: { letter: 'ES', bg: '#fec514' },
  rabbitmq: { letter: 'R', bg: '#ff6600' },
  kafka: { letter: 'K', bg: '#231f20' },
  grafana: { letter: 'G', bg: '#f46800' },
  prometheus: { letter: 'P', bg: '#e6522c' },
  jenkins: { letter: 'J', bg: '#d24939' },
  tomcat: { letter: 'T', bg: '#f8dc75' },
  python: { letter: 'Py', bg: '#3776ab' },
  node: { letter: 'N', bg: '#339933' },
  openjdk: { letter: 'J', bg: '#5382a1' },
  java: { letter: 'J', bg: '#5382a1' },
  golang: { letter: 'G', bg: '#00add8' },
  go: { letter: 'G', bg: '#00add8' },
  ubuntu: { letter: 'U', bg: '#e95420' },
  alpine: { letter: 'A', bg: '#0d597f' },
  debian: { letter: 'D', bg: '#d70a53' },
  centos: { letter: 'C', bg: '#262577' },
  chroma: { letter: 'C', bg: '#7a4cff' },
  minio: { letter: 'M', bg: '#c72e49' },
  etcd: { letter: 'E', bg: '#419eda' },
  coredns: { letter: 'C', bg: '#1e6feb' },
  consul: { letter: 'C', bg: '#ca2171' },
  nats: { letter: 'N', bg: '#27aae1' },
  memcached: { letter: 'M', bg: '#5a7c8a' },
  sqlserver: { letter: 'S', bg: '#cc2927' },
  clickhouse: { letter: 'C', bg: '#9a6700' },
  'clickhouse-server': { letter: 'C', bg: '#9a6700' },
  cassandra: { letter: 'C', bg: '#1287b1' },
  couchdb: { letter: 'C', bg: '#b58500' },
  couchbase: { letter: 'C', bg: '#ea2328' },
  influxdb: { letter: 'I', bg: '#22adf6' },
  timescaledb: { letter: 'T', bg: '#c98400' },
  cockroachdb: { letter: 'C', bg: '#6933ff' },
  neo4j: { letter: 'N', bg: '#008cc1' },
  oracle: { letter: 'O', bg: '#d9411e' },
  sqlite: { letter: 'S', bg: '#0f80cc' },
  valkey: { letter: 'V', bg: '#c72e49' },
  keydb: { letter: 'K', bg: '#2c3e50' },
  dragonfly: { letter: 'D', bg: '#d24d3a' },
  tidb: { letter: 'T', bg: '#2d9cdb' },
  opengauss: { letter: 'O', bg: '#b6cbd3' },
  zookeeper: { letter: 'Z', bg: '#b8860b' },
  activemq: { letter: 'A', bg: '#2c6fbb' },
  pulsar: { letter: 'P', bg: '#188fff' },
  emqx: { letter: 'E', bg: '#00b3c8' },
  mosquitto: { letter: 'M', bg: '#3c5280' },
  rocketmq: { letter: 'R', bg: '#d9373e' },
  hazelcast: { letter: 'H', bg: '#e8833a' },
  opensearch: { letter: 'O', bg: '#005eb8' },
  solr: { letter: 'S', bg: '#d9411e' },
  httpd: { letter: 'A', bg: '#d22128' },
  apache: { letter: 'A', bg: '#d22128' },
  caddy: { letter: 'C', bg: '#1f5d8c' },
  traefik: { letter: 'T', bg: '#24a1c1' },
  envoy: { letter: 'E', bg: '#ac6199' },
  openresty: { letter: 'O', bg: '#009639' },
  keycloak: { letter: 'K', bg: '#008aaa' },
  kibana: { letter: 'K', bg: '#005571' },
  logstash: { letter: 'L', bg: '#00bfb3' },
  loki: { letter: 'L', bg: '#c9a227' },
  jaeger: { letter: 'J', bg: '#3aa0b8' },
  fluentd: { letter: 'F', bg: '#0e83c5' },
  vault: { letter: 'V', bg: '#c9ad00' },
  harbor: { letter: 'H', bg: '#007cad' },
  portainer: { letter: 'P', bg: '#13bef9' },
  gitlab: { letter: 'G', bg: '#fc6d26' },
  gitea: { letter: 'G', bg: '#609926' },
  sonarqube: { letter: 'S', bg: '#4b9fd6' },
  skywalking: { letter: 'S', bg: '#c47f17' },
  cadvisor: { letter: 'C', bg: '#009688' },
  thanos: { letter: 'T', bg: '#00a9e0' },
  ollama: { letter: 'O', bg: '#3b82f6' },
  n8n: { letter: 'n', bg: '#ea4b71' }
}

// k8s 系统组件镜像关键词（配合 k8s_ 名称前缀使用）
export const K8S_IMAGE_KEYWORDS = [
  'coredns',
  'local-path',
  'pause',
  'kube-apiserver',
  'kube-controller-manager',
  'kube-scheduler',
  'kube-proxy',
  'kube-state-metrics',
  'kube-root-ca',
  'etcd',
  'metrics-server',
  'calico',
  'flannel',
  'ingress-nginx',
  'multus',
  'node-cache'
]

// 判断容器是否属于 k8s：k8s_ 名称前缀 或 镜像名命中 k8s 系统组件关键词
export function isK8sContainer(c: ContainerSummary): boolean {
  if (c.name.startsWith('k8s_')) return true
  const img = (c.image || '').toLowerCase()
  return K8S_IMAGE_KEYWORDS.some((kw) => img.includes(kw))
}

// 取镜像 basename（去仓库前缀与 tag）
export function imageBasename(image: string): string {
  return (image || '').split('/').pop()?.split(':')[0]?.toLowerCase() || ''
}

// simple-icons 图标 → 品牌色 SVG data URL
function iconDataUrl(icon: SimpleIcon | undefined): string {
  if (!icon) return ''
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">` +
    `<path fill="#${icon.hex}" d="${icon.path}"/></svg>`
  return 'data:image/svg+xml,' + encodeURIComponent(svg)
}

// Kubernetes 分组组头 logo
export const K8S_LOGO = iconDataUrl(siKubernetes)

// 独立容器分组组头 logo
export const DOCKER_LOGO = iconDataUrl(siDocker)

// 品牌 LOGO 的 SVG data URL；无对应图标返回 ''（调用方回退字母徽章）
export function imageLogoDataUrl(image: string): string {
  return iconDataUrl(ICON_BY_IMAGE[imageBasename(image)])
}

// 品牌色缩写徽章（simple-icons 缺失时回退）
export function imageBadge(image: string): ImageBadge {
  const base = imageBasename(image)
  const known = IMAGE_BADGES[base]
  if (known) return known
  return { letter: (base[0] || '?').toUpperCase(), bg: '#8e8e93' }
}
