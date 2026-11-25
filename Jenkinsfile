pipeline {
  agent { label 'docker' }
  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }
  parameters {
    string(name: 'REGISTRY', defaultValue: '', description: 'Container registry host, e.g. ghcr.io/org')
    string(name: 'IMAGE', defaultValue: 'bugshaper-backend', description: 'Image name without tag')
    booleanParam(name: 'PUSH', defaultValue: false, description: 'Push the image after a successful build')
  }
  environment {
    NODE_VERSION = '22'
    IMAGE_TAG = "${env.BUILD_NUMBER}-${env.GIT_COMMIT?.take(7) ?: 'local'}"
  }
  stages {
    stage('Verify packages') {
      parallel {
        stage('website') {
          agent { docker { image "node:${NODE_VERSION}-bookworm-slim"; reuseNode true } }
          steps {
            dir('website') {
              sh 'npm ci'
              sh 'npm run check'
              sh 'npm run build'
              sh 'npm test'
            }
          }
        }
        stage('backend') {
          agent { docker { image "node:${NODE_VERSION}-bookworm-slim"; reuseNode true } }
          steps {
            dir('website') {
              sh 'npm ci'
              sh 'npm run build'
            }
            dir('backend') {
              sh 'npm test'
            }
          }
        }
        stage('cli') {
          agent { docker { image "node:${NODE_VERSION}-bookworm-slim"; reuseNode true } }
          steps {
            dir('cli') {
              sh 'npm run check'
              sh 'npm test'
            }
          }
        }
        stage('extension') {
          agent { docker { image "node:${NODE_VERSION}-bookworm-slim"; reuseNode true } }
          steps {
            dir('extension') {
              sh 'npm test'
            }
          }
        }
      }
    }
    stage('Docker image') {
      steps {
        script {
          def tag = "${params.IMAGE}:${IMAGE_TAG}"
          sh "docker build -f backend/Dockerfile --build-context website=./website -t ${tag} ./backend"
          if (params.PUSH) {
            if (!params.REGISTRY?.trim()) { error 'REGISTRY is required when PUSH=true' }
            def remote = "${params.REGISTRY}/${params.IMAGE}"
            sh "docker tag ${tag} ${remote}:${IMAGE_TAG}"
            sh "docker push ${remote}:${IMAGE_TAG}"
            env.PUSHED_IMAGE = "${remote}:${IMAGE_TAG}"
          }
        }
      }
    }
  }
}
