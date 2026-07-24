import type { CustomCommand, Project } from '../types';

const AUTO_INSTALL_COMMAND_NAMES = new Set([
  '安装依赖',
  'Install Dependencies',
]);

function getBuiltinCommandLabelByLocale(builtinId: CustomCommand['builtinId'], locale: 'zh' | 'en') {
  if (builtinId === 'install_dependencies') {
    return locale === 'en' ? 'Install Dependencies' : '安装依赖';
  }

  return '';
}

export function getInstallDependenciesCommand(packageManager?: Project['packageManager']) {
  switch (packageManager) {
    case 'yarn':
      return 'yarn install';
    case 'pnpm':
      return 'pnpm install';
    case 'cnpm':
      return 'cnpm install';
    case 'npm':
    default:
      return 'npm install';
  }
}

export function getCustomCommandDisplayName(
  command: Pick<CustomCommand, 'name' | 'builtinId'>,
  translate: (key: string) => string,
) {
  if (command.builtinId === 'install_dependencies') {
    return translate('project.installDependencies');
  }

  return command.name;
}

export function getCustomCommandDisplayNameByLocale(
  command: Pick<CustomCommand, 'name' | 'builtinId'>,
  locale: 'zh' | 'en',
) {
  if (command.builtinId) {
    return getBuiltinCommandLabelByLocale(command.builtinId, locale);
  }

  return command.name;
}

export function ensureNodeInstallCommand<T extends Pick<Project, 'type' | 'packageManager' | 'customCommands'>>(
  project: T,
  installCommandName: string,
): T {
  if (project.type !== 'node') {
    return project;
  }

  const installCommand = getInstallDependenciesCommand(project.packageManager);
  let hasInstallCommand = false;

  const customCommands = (Array.isArray(project.customCommands)
    ? project.customCommands.filter((command) => command.name && command.command)
    : []).map((command) => {
      const isInstallCommand =
        command.builtinId === 'install_dependencies' ||
        (AUTO_INSTALL_COMMAND_NAMES.has(command.name.trim()) &&
          isInstallDependenciesCommand(command.command.trim()));

      if (!isInstallCommand) {
        return command;
      }

      hasInstallCommand = true;
      return {
        ...command,
        builtinId: 'install_dependencies' as const,
        name: command.name || installCommandName,
        command: installCommand,
      };
    });

  if (hasInstallCommand) {
    return {
      ...project,
      customCommands,
    };
  }

  const nextCommands: CustomCommand[] = [
    {
      id: crypto.randomUUID(),
      name: installCommandName,
      command: installCommand,
      builtinId: 'install_dependencies',
    },
    ...customCommands,
  ];

  return {
    ...project,
    customCommands: nextCommands,
  };
}

function isInstallDependenciesCommand(command: string): boolean {
  const installCommands = ['npm install', 'yarn install', 'pnpm install', 'cnpm install'];
  return installCommands.includes(command);
}
