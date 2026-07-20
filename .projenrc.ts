import { github, javascript } from 'projen';
import { UpgradeDependenciesSchedule } from 'projen/lib/javascript';
import { GitHubActionTypeScriptProject, RunsUsing } from 'projen-github-action-typescript';

const projenCredentials = github.GithubCredentials.fromApp({
  appIdSecret: 'CICD_APP_ID',
  privateKeySecret: 'CICD_APP_PRIVKEY',
});

const project = new GitHubActionTypeScriptProject({
  defaultReleaseBranch: 'main',
  devDeps: [
    'projen-github-action-typescript',
    'vitest@^4',
    '@vitest/coverage-v8@^4',
  ],
  deps: [
    '@actions/core@^2.0.3',
  ],
  name: 'setup-environments-action',
  packageManager: javascript.NodePackageManager.NPM,
  projenrcTs: true,
  minNodeVersion: '24.15.0',
  githubOptions: {
    mergify: false,
    mergeQueue: true,
    mergeQueueOptions: {
      targetBranches: ['main'],
      autoQueueOptions: {
        targetBranches: ['main'],
        projenCredentials,
      },
    },
    projenCredentials,
  },
  depsUpgradeOptions: {
    workflowOptions: {
      projenCredentials,
      labels: ['deps-upgrade'],
      schedule: UpgradeDependenciesSchedule.WEEKLY,
    },
  },
  autoApproveOptions: {
    label: 'deps-upgrade',
    allowedUsernames: [
      'sv-oss-continuous-delivery[bot]',
    ],
  },
  tsconfig: {
    compilerOptions: {
      lib: ['es2022'],
    },
  },
  dependabot: false,
  minMajorVersion: 1,
  license: 'MIT',
  copyrightOwner: 'Service Victoria',
  actionMetadata: {
    author: 'Service Victoria Platform Engineering',
    name: 'Setup Environments',
    description: 'Action to configures environments in a repository',
    runs: {
      // WARNING: This is a temp workaround to prevent the action breaking soon.
      // Ideally, upgrade projen-github-action-typescript and use the proper `RunsUsing` enum when it's available
      using: 'node24' as RunsUsing, // RunsUsing.NODE_24, // For v24, we need: https://github.com/projen/projen-github-action-typescript/pull/529
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
  jest: false,
  buildWorkflowOptions: {
    mutableBuild: false,
  },
});

project.addDeps('@actions/core@^2.0.3', '@actions/github@^8.0.1');

// Security floors for transitive dependencies whose parent ranges still allow
// vulnerable versions. Remove these once the parent ranges are raised:
// @actions/github/@actions/http-client to undici >=6.27.0, and
// commit-and-tag-version to fast-xml-parser >=5.9.3.
project.package.addField('overrides', {
  'undici': '^6.27.0',
  'fast-xml-parser': '^5.9.3',
});

// Configure vitest as the test runner
const testTask = project.tasks.tryFind('test')!;
testTask.reset('vitest run --coverage --passWithNoTests', { receiveArgs: true });
const watchTask = project.tasks.tryFind('test:watch');
if (watchTask) {
  watchTask.reset('vitest', { receiveArgs: true });
}
const eslintTask = project.tasks.tryFind('eslint');
if (eslintTask) {
  testTask.spawn(eslintTask);
}

project.addGitIgnore('/coverage/');
project.addGitIgnore('/test-reports/');
project.addGitIgnore('junit.xml');

// Ensure test/coverage artifacts are never published to npm even if they
// happen to be present in the working tree at pack/publish time.
project.addPackageIgnore('/coverage/');
project.addPackageIgnore('/test-reports/');
project.addPackageIgnore('junit.xml');

// Build the project after upgrading so that the compiled JS ends up being committed
project.tasks.tryFind('post-upgrade')?.spawn(project.buildTask);

// Add a step after release is pushed to github, to update the `v1/v2` Major Version tag
// to point to the new release commit SHA
project.release?.publisher.addGitHubPostPublishingSteps({
  name: 'Update floating major tag',
  if: '${{ success() }}',
  env: {
    GH_TOKEN: '${{ github.token }}',
  },
  run: [
    'RELEASE_TAG=$(cat dist/releasetag.txt)',
    'if [[ ! "$RELEASE_TAG" =~ ^v([0-9]+)\\.[0-9]+\\.[0-9]+$ ]]; then',
    '  echo "Expected a stable v<major>.<minor>.<patch> release tag, got: $RELEASE_TAG" >&2',
    '  exit 1',
    'fi',
    'FLOATING_TAG="v${BASH_REMATCH[1]}"',
    'ERROR_FILE=$(mktemp)',
    'trap \'rm -f "$ERROR_FILE"\' EXIT',
    'if gh api "repos/$GITHUB_REPOSITORY/git/ref/tags/$FLOATING_TAG" > /dev/null 2> "$ERROR_FILE"; then',
    '  gh api --method PATCH "repos/$GITHUB_REPOSITORY/git/refs/tags/$FLOATING_TAG" -f sha="$GITHUB_SHA" -F force=true',
    'elif grep -q "HTTP 404" "$ERROR_FILE"; then',
    '  gh api --method POST "repos/$GITHUB_REPOSITORY/git/refs" -f ref="refs/tags/$FLOATING_TAG" -f sha="$GITHUB_SHA"',
    'else',
    '  cat "$ERROR_FILE" >&2',
    '  exit 1',
    'fi',
  ].join('\n'),
});

// Projen only enables auto-merge when a PR opens or changes base branch, even
// though it subscribes to ready_for_review. Run for every non-draft PR so a
// draft is automatically queued once it becomes ready for review.
project.tryFindObjectFile('.github/workflows/auto-queue.yml')?.addOverride(
  'jobs.enableAutoQueue.if',
  'github.event.pull_request.draft == false',
);

project.synth();
