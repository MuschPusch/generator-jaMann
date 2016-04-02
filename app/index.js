'use strict';
var generators = require('yeoman-generator');
var chalk = require('chalk');
var updateNotifier = require('update-notifier');
var yosay = require('yosay');
var _ = require('underscore');
var fs = require('fs');
var shell = require('shelljs');
var async = require('async');
var cowsay = require('cowsay');
var request = require('request');
var optionOrPrompt = require('yeoman-option-or-prompt');
var jsonfile = require('jsonfile');

module.exports = generators.Base.extend({

  _optionOrPrompt: optionOrPrompt,


  constructor: function () {
    generators.Base.apply(this, arguments);

    this.options = {
      fabalicious: true,
    };
  },

  initializing: function () {
    // Check for updates.
    var pkg = require('../package.json');
    updateNotifier({pkg: pkg}).notify();

    // @TODO: do this better.
    // Check for multibasebox.
    if (!fs.existsSync('./projects')){
      this.log(chalk.red('You must be in your multibasebox folder. Multibasebox not installed? We will create a generator for that! Until that please follow the instructions here: github.com/factorial-io/multibasebox'));
      shell.exit(1);
    }
  },

  _checkRequirements: function(cmds) {
    // Check requirements.
    var requirements = {
      composer: 'curl -sS https://getcomposer.org/installer | php',
      pip: 'brew install python',
      fab: 'pip install fabric',
    };
    _.each(cmds, function(key) {
      var command = requirements[key];
      if (!shell.which(key)) {
        console.log('Sorry, this script requires ' + key + '. Install it on a Mac using: ' + command);
        shell.exit(1);
      }
    });
  },

  _getPaths : function(projectName) {
    var base = process.env.PWD;
    return {
      'base': base,
      'projects': base + '/projects',
      'tools': base + '/projects/' + projectName + '/_tools',
      'project': base + '/projects/' + projectName,
      'projectRelative': 'projects/' + projectName
    };
  },

  _getAvailablePort: function(callback) {
    var that = this;

    // get all project folders:
    var rootDir = this._getPaths().base + '/projects';
    var files = fs.readdirSync(rootDir);
    var dirs = [];
    _.each(files, function(file) {
      if (file[0] !== '.') {
        var filePath = rootDir + '/' + file;
        try {
          var stat = fs.statSync(filePath + '/fabfile.py');

          if(stat.isFile()) {
             dirs.push(file);
          }
        }
        catch(e) {

        }
      }
    });

    if (dirs.length === 0) {
      callback(222);
    }

    var ports = [];
    async.each(dirs, function(dir, done) {

      var cmd = 'cd ' + rootDir + '/' + dir + '; fab  --hide=running config:mbb getProperty:port';
      shell.exec(cmd, { 'silent': true }, function(code, output) {
        if (code) {
          // that.log(chalk.red('Could not get port-setting for project ' + dir + ', please update fabalicious.'));
        }
        else {
          var lines = output.split('\n');
          var foundPort = false;

          lines.reverse();
          _.each(lines, function(line) {
            line = line.trim();
            if ((line.length > 0) && !foundPort) {
              foundPort = line;
              // console.log('found: ' + foundPort);
            }
          });
          if (foundPort) {
            ports.push(parseInt(foundPort));
          }
        }
        // notify async that we are finished with this async-task.
        done();
      });
    }, function() {
      // final callback, when all tasks are finished, compute port.
      var highestPort = 222;
      _.each(ports, function(port) {
        if(port > highestPort) {
          highestPort = port;
        }
      });
      // notify caller that we are finished.
      callback(highestPort);
    });


  },

  _installTemplateFiles: function(paths, templates, values) {
    var that = this;
    _.each(templates, function(target, source) {
      that.fs.copyTpl(that.templatePath(source), that.destinationPath(paths.projectRelative + '/' + target), values);
    });
  },

  // Prompt for options.
  prompting: function () {
    var that = this;
    var cb = this.async();

    // Say yo!
    this.log(yosay(
      'Welcome to the ' + chalk.red('JaMensch') + ' generator!'
    ));

    this._optionOrPrompt([{
      type: 'input',
      name: 'name',
      message: 'Name of your project',
      validate: function(input) {
        if (input.match(/^[a-zA-Z0-9_]+$/) && input.length > 3 && input.length < 31) {
          return true;
        }
        else {
          return 'Project name can only contain letters, numbers and underscores and cannot be fewer than 4 or more than 30 characters';
        }
      },
    }], function (answer) {
      that.answer = answer;
      cb();
    });
  },

  _runCommand: function(path, command, cb) {
    var cmd = '(cd ' + path + '; ' + command + ')';
    shell.exec(cmd, {}, function(code, output) {
      cb( (code !== 0) ? code : null);
    });
  },

  install: function () {
    this._checkRequirements(['composer', 'pip', 'fab']);
    var paths = this._getPaths(this.answer.name);
    var values = this.answer;

    this.log('Installing Drupal 8 via composer');

    if(fs.existsSync(paths.project)) {
      this.log(chalk.red('Project directory exists already!'));
      return;
    }
    // Call theses functions in series.
    async.series([
      function(cb) {
        this._runCommand(paths.projects, 'composer create-project drupal-composer/drupal-project:8.x-dev ' + values.name + " --stability dev --no-interaction", cb);
      }.bind(this),

      function(cb) {
        this._runCommand(paths.project, 'composer require factorial-io/fabalicious:dev-develop', cb);
      }.bind(this),

      function(cb) {
        var composerFile = paths.project + '/composer.json';
        jsonfile.readFile(composerFile, function(err, obj) {
          obj.scripts['post-install-cmd'].push('ln -sf _tools/fabalicious/fabfile.py fabfile.py');
          jsonfile.writeFile(composerFile, obj, {spaces: 2}, function(err) {
            cb(err);
          });
        });
      }.bind(this),

      function(cb) {
        this._getAvailablePort(function(port) {
          values.port = port + 1;
          cb();
        });
      }.bind(this),

      function(cb) {
        var moduleName = values.name + '_deploy';

        var templateFiles = {
          '_fabfile.yaml': 'fabfile.yaml',
          '_docker-compose.yml': 'docker-compose.yml',
          '_docker-compose-mbb.yml': 'docker-compose-mbb.yml',
          'deploy-module/_composer.json': 'web/modules/custom/' + moduleName + '/composer.json',
          'deploy-module/_deploy.info.yml': 'web/modules/custom/' + moduleName + '/' + moduleName +'.info.yml',
          'deploy-module/_deploy.install': 'web/modules/custom/' + moduleName + '/' + moduleName +'.install',
          'deploy-module/_deploy.module': 'web/modules/custom/' + moduleName + '/' + moduleName +'.module',
        }
        this._installTemplateFiles(paths, templateFiles, values);
        cb();
      }.bind(this)

    ], function (err, results) {
    });
  }
});
