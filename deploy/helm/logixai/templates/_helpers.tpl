{{- define "logixai.labels" -}}
app.kubernetes.io/part-of: logixai
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end }}

{{- define "logixai.image" -}}
{{ .root.Values.image.registry }}/{{ .name }}:{{ .root.Values.image.tag }}
{{- end }}

{{/* Env shared by every API service. */}}
{{- define "logixai.commonEnv" -}}
- name: NODE_ENV
  value: production
- name: IDENTITY_JWKS_URL
  value: http://identity:3006/.well-known/jwks.json
- name: CORS_ORIGINS
  value: https://{{ .Values.domain }}
- name: INTERNAL_API_TOKEN
  valueFrom: { secretKeyRef: { name: {{ .Values.existingSecret }}, key: INTERNAL_API_TOKEN } }
{{- range $k, $v := .Values.config }}
- name: {{ $k }}
  value: {{ $v | quote }}
{{- end }}
{{- end }}

{{- define "logixai.redisEnv" -}}
- name: REDIS_HOST
  value: {{ .Values.redis.host | quote }}
- name: REDIS_PORT
  value: {{ .Values.redis.port | quote }}
- name: REDIS_TLS
  value: {{ .Values.redis.tls | quote }}
- name: REDIS_PASSWORD
  valueFrom: { secretKeyRef: { name: {{ .Values.existingSecret }}, key: REDIS_PASSWORD } }
{{- end }}

{{/* DB_CONNECTION_STRING for one database, built from the secret's base URI. */}}
{{- define "logixai.mongoEnv" -}}
- name: MONGODB_URI_BASE
  valueFrom: { secretKeyRef: { name: {{ .root.Values.existingSecret }}, key: MONGODB_URI_BASE } }
- name: DB_CONNECTION_STRING
  value: "$(MONGODB_URI_BASE)/{{ .database }}{{ .root.Values.mongodb.uriOptions }}"
{{- end }}
