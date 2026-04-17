import { github, javascript } from 'projen';
import { GitHubActionTypeScriptProject, RunsUsing } from 'projen-github-action-typescript';

const project = new GitHubActionTypeScriptProject({
  defaultReleaseBranch: 'main',
  devDeps: [
    'projen-github-action-typescript',
  ],
  name: 'setup-environments-action',
  packageManager: javascript.NodePackageManager.NPM,
  projenrcTs: true,
  minNodeVersion: '24.15.0',
  depsUpgradeOptions: {
    workflowOptions: {
      projenCredentials: github.GithubCredentials.fromApp({
        appIdSecret: 'CICD_APP_ID',
        privateKeySecret: 'CICD_APP_PRIVKEY',
      }),
      labels: ['deps-upgrade'],
    },
  },
  autoApproveOptions: {
    label: 'deps-upgrade',
    allowedUsernames: [
      'sv-oss-continuous-delivery[bot]',
    ],
  },
  dependabot: false,
  mutableBuild: false,
  minMajorVersion: 1,
  license: 'MIT',
  copyrightOwner: 'Service Victoria',
  actionMetadata: {
    author: 'Service Victoria Platform Engineering',
    name: 'Setup Environments',
    description: 'Action to configures environments in a repository',
    runs: {
      using: RunsUsing.NODE_20, // For v24, we need: https://github.com/projen/projen-github-action-typescript/pull/529
      main: 'dist/index.js',
    },
    inputs: {
      token: {
        description: 'Github token with the scope "repo"',
        required: true,
      },
      repository: {
        description: 'Repository name with owner. For example, sv-oss/repo',
        required: false,
        default: '${{ github.repository }}',
      },
      environments: {
        description: 'Comma-separated list of Environments to configure',
        required: true,
      },
      reviewers: {
        description: 'Comma-separated list of required reviewers e.g. "org/team,user" max 6',
        required: false,
      },
    },
  },
});

// Build the project after upgrading so that the compiled JS ends up being committed
project.tasks.tryFind('post-upgrade')?.spawn(project.buildTask);

// Projen bug: generates deprecated `status-success` condition; override with the correct `check-success`
// https://docs.mergify.com/configuration/conditions/#attributes-list
const conditions = ['#approved-reviews-by>=1', '-label~=(do-not-merge)', 'check-success=build'];
const mergifyFile = project.tryFindObjectFile('.mergify.yml');
mergifyFile?.addOverride('queue_rules.0.queue_conditions', conditions);
mergifyFile?.addOverride('pull_request_rules.0.conditions', conditions);

project.release?.addJobs({
  'floating-tags': {
    permissions: {
      contents: github.workflows.JobPermission.WRITE,
    },
    runsOn: ['ubuntu-latest'],
    needs: ['release_github'],
    steps: [
      { uses: 'actions/checkout@v6' },
      { uses: 'giantswarm/floating-tags-action@v1' },
    ],
  },
});

project.synth();