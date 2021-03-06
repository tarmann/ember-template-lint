'use strict';

const path = require('path');
const resolve = require('resolve');
const assign = require('lodash').assign;
const chalk = require('chalk');
const Minimatch = require('minimatch').Minimatch;
const defaultRules = require('./rules');
const defaultConfigurations = require('./config/index');

const KNOWN_ROOT_PROPERTIES = ['extends', 'rules', 'pending', 'ignore', 'plugins'];

function resolveConfigPath(configPath, pluginPath) {

  configPath = configPath || path.join(process.cwd(), '.template-lintrc');


  if (pluginPath) {

    //throws exception if not found
    pluginPath = resolve.sync(pluginPath, { basedir: path.dirname(configPath) });

  }

  try {
    let filePath = pluginPath || configPath;
    return require(filePath);
  } catch(e) {
    return {};
  }

}

function ensureRootProperties(config, source, options) {
  let logger = options.console || console;

  config.rules = assign({}, source.rules || {});
  config.pending = (source.pending || []).slice();
  config.ignore = (source.ignore || []).slice();
  config.plugins = (source.plugins || []).slice();

  let extendedList = [];
  if (source.extends) {
    if (typeof source.extends === 'string') {
      extendedList = [source.extends];
    } else if (Array.isArray(source.extends)) {
      extendedList = source.extends.slice();
    } else {
      logger.log(chalk.yellow('config.extends should be string or array '));
    }
  }
  config.extends = extendedList;
}

function migrateRulesFromRoot(config, source, options) {
  let logger = options.console || console;

  let invalidKeysFound = [];
  for (let key in source) {
    if (KNOWN_ROOT_PROPERTIES.indexOf(key) === -1) {
      invalidKeysFound.push(key);

      config.rules[key] = source[key];
    }
  }

  if (invalidKeysFound.length > 0) {
    logger.log(chalk.yellow(
      [
        'Rule configuration has been moved into a `rules` property.',
        'Please update your `.template-lintrc.js` file.',
        'The following rules have been migrated to the `rules`',
        `property: ${invalidKeysFound}.`
      ].join(' ')
    ));
  }
}

function processPlugins(config, options) {

  let logger = options.console || console;

  let configPlugins = config.plugins;
  let pluginsHash = {};

  for (let i = 0; i < configPlugins.length; i++) {

    let plugin = configPlugins[i];
    let pluginName;

    if (typeof plugin === 'string') {
      pluginName = plugin;
      plugin = resolveConfigPath(options.configPath, pluginName);
    }


    let errorMessage;
    if (typeof plugin === 'object') {

      if (plugin.name) {
        pluginsHash[plugin.name] = plugin;
      } else if (pluginName) {
        errorMessage = `Plugin (${pluginName}) has not defined the plugin \`name\` property`;
      } else {
        errorMessage = 'Inline plugin object has not defined the plugin `name` property';
      }

    } else if (pluginName) {
      errorMessage = `Plugin (${pluginName}) did not return a plain object`;
    } else {
      errorMessage = 'Inline plugin is not a plain object';
    }

    if (errorMessage) {
      logger.log(chalk.yellow(errorMessage));
    }

  }

  config.plugins = pluginsHash;
}

function processLoadedRules(config) {

  //load all the default rules in `ember-template-lint`
  let loadedRules = assign({}, defaultRules);

  //load plugin rules
  for (let name in config.plugins) {

    let pluginRules = config.plugins[name].rules;
    if (pluginRules) {
      loadedRules = assign(loadedRules, pluginRules);
    }

  }

  config.loadedRules = loadedRules;

}

function processLoadedConfigurations(config) {

  //load all the default configurations in `ember-template-lint`
  let loadedConfigurations = assign({}, defaultConfigurations);

  //load plugin configurations
  for (let pluginName in config.plugins) {

    let pluginConfigurations = config.plugins[pluginName].configurations;
    if (pluginConfigurations) {

      for (let configurationName in pluginConfigurations) {


        let name = `${pluginName}:${configurationName}`;
        loadedConfigurations[name] = pluginConfigurations[configurationName];

      }
    }

  }

  config.loadedConfigurations = loadedConfigurations;

}

function processExtends(config, options) {

  let logger = options.console || console;

  let extendedList = config.extends;

  for (let i = 0; i < extendedList.length; i++) {

    let extendName = extendedList[i];

    let configuration = config.loadedConfigurations[extendName];
    if (configuration) {

      if (configuration.rules) {

        config.rules = assign({}, configuration.rules, config.rules);

      } else {

        logger.log(chalk.yellow(`Missing rules for extends: ${extendName}`));

      }

    } else {

      logger.log(chalk.yellow(`Cannot find configuration for extends: ${extendName}`));

    }

    delete config.extends;
  }

}

function processIgnores(config) {
  config.ignore = config.ignore.map((pattern) => new Minimatch(pattern));
}

function validateRules(config, options) {
  let logger = options.console || console;
  let invalidKeysFound = [];

  for (let key in config.rules) {
    if (!config.loadedRules[key]) {
      invalidKeysFound.push(key);
    }
  }

  if (invalidKeysFound.length > 0) {
    logger.log(chalk.yellow(`Invalid rule configuration found: ${invalidKeysFound}`));
  }
}

module.exports = function(options) {
  let source = options.config || resolveConfigPath(options.configPath);
  let config;

  if (source._processed) {
    config = source;
  } else {
    // don't mutate a `require`d object, you'll have a bad time
    config = {};

    ensureRootProperties(config, source, options);
    migrateRulesFromRoot(config, source, options);

    processPlugins(config, options);
    processLoadedRules(config);
    processLoadedConfigurations(config);
    processExtends(config, options);
    processIgnores(config);

    validateRules(config, options);

    config._processed = true;
  }

  return config;
};
