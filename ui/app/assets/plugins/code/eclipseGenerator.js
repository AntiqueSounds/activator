/**
 * Copyright (C) 2014 Typesafe <http://typesafe.com/>
 *
 * Responsible for creating an Eclipse project from the template in use.
 * It exposes one method 'generate' with which the project file generation is triggered.
 * There are a couple of states that the generation goes through, some of which are callbacks from the sbt-server and some direct request/response calls.
 *
 * Basically the steps that the process goes through are:
 * 1. check for existing Eclipse project (and abort if it exists)
 * 2. check if the sbt 'eclipse' command is available (to determine if the Eclipse sbt plugin is installed)
 *    a. if available, invoke and terminate process
 *    b. if not, add an eclipse.sbt file to the project
 * 3. restart sbt server (to pick up the new plugin information)
 * 4. run 'eclipse' command to generate files
 *
 * The process continuously keeps track of what state is in and provides feedback to the UI what is going on.
 *
 *
 * FIXME:s
 * Still lots of things to do:
 * - send feedback to UI of what status the process is in
 * - have better hook from sbt-server for when a start/restart is done (right now it's done by parsing text message for specific string)
 * - handle already existing plugin files and add sbtBinaryVersion in ThisBuild := "0.13" to the beginning (fix for sbt-rc)
 *   (this will be taken care of automatically when sbt-rc uses sbt with a fix for binary versions (see: https://github.com/sbt/sbt/pull/1433))
 * - take care of a process that is stuck in a certain phase, i.e. if some step fails the 'currentState' is not 'idle' so the process can not be restarted
 * - generalize this whole thing to accommodate similar tasks (open in IDEA, browser, etc).
 *
 * For more info see TODOs below of what still need proper implementation.
 */
define(['commons/streams', 'services/sbt', 'services/ajax'], function (stream, sbt, ajax) {
  // available states
  var idle = 1;
  var checkingProjectFile = 2;
  var checkingCommand = 3;
  var generatingFile = 4;
  var restartingSbt = 5;
  var runningCommand = 6;

  var self = this;
  var workingStatus;

  // Constants used in this process
  var projectFile = ".project";
  var sbtEclipseProjectLocation = "/project/eclipse.sbt";
  // Note that the first line in the content, "sbtBinaryVersion...", is needed as long as this fix is not in sbt: https://github.com/sbt/sbt/pull/1433
  var pluginFileContent = "sbtBinaryVersion in ThisBuild := \"0.13\"\n\naddSbtPlugin(\"com.typesafe.sbteclipse\" % \"sbteclipse-plugin\" % \"2.3.0\")";

  // State flags used to drive the process
  var currentState = idle;
  var currentExecutionId = -1;

  stream.subscribe({
    handler: function (msg) {
      if (msg.type === 'sbt') {

        // STATE : CHECKING IF ECLIPSE COMMAND IS AVAILABLE
        // TODO : ADD currentExecutionId === msg.event.id
        if (currentState === checkingCommand) {
          if (msg.subType === 'ExecutionFailure') {
            resetExecutionId();
            // Eclipse command could not be executed - continue with the process
            generateFile();
          } else if (msg.subType === 'ExecutionSuccess') {
            resetState("Eclipse files generated.");
          }
        }

        // STATE : SBT RESTARTED
        // TODO : ADD currentExecutionId === msg.event.id
        else if (currentState === restartingSbt) {
          // TODO : implement a better indicator of a restart on the sbt-rc side
          // This is only a temp solution to close the whole chain
          if (msg.event.entry.message.indexOf("Opened sbt") > -1) {
            runCommand();
          }
        }

        // STATE : EXECUTING ECLIPSE COMMAND
        // TODO : ADD currentExecutionId === msg.event.id
        else if (currentState === runningCommand) {
          if (msg.subType === 'ExecutionFailure') {
            resetState("Could not run the eclipse command. Please try again.");
          } else if (msg.subType === 'ExecutionSuccess') {
            // TODO : update status that files have been generated
            resetState("Eclipse files generated.");
          }
        }
      }
    }
  });

  var generate = function(status, overrideExisting) {
    self.workingStatus = status;
    self.workingStatus("Hold tight, generating Eclipse project files...");
    checkProjectFile(overrideExisting);
  };

  var checkProjectFile = function(overrideExisting) {
    if (overrideExisting === true) {
      checkCommand();
    } else {
      if (currentState !== idle) {
        self.workingStatus("Cannot start process since is already in progress. Click here to restart the process");
      } else {
        currentState = checkingProjectFile;
        self.workingStatus("Checking for existing project files...");

        if (hasProjectFile() === true) {
          // TODO: give the user the opportunity to regenerate the Eclipse files?
          resetState("There already is an existing Eclipse project in your folder. Exiting the generation process.");
        } else {
          // No project files found - continue the process
          checkCommand();
        }
      }
    }
  }

  var hasProjectFile = function() {
    // Look for a ".project" file in the home directory to see if there already is an existing Eclipse project
    ajax.browse(serverAppModel.location + "/" + projectFile).done(function (data) {
      return true;
    }).error(function () {
      return false;
    });
  }

  var checkCommand = function() {
    currentState = checkingCommand;
    self.workingStatus("Running sbt eclipse command to generate project files...");
    var result = runEclipseCommand();
    // TODO: extract response id
    if (result === undefined) {
      // Something went wrong - reset
      resetState("Did not receive any response from server. Please try again.");
    } else {
      // TODO: set correct response id
      currentExecutionId = 1;
    }
  };

  var runEclipseCommand = function() {
    return sbt.requestExecution("eclipse");
  };

  var runCommand = function() {
    currentState = runningCommand;
    self.workingStatus("Running sbt eclipse command...");
    var result = runEclipseCommand();
    // TODO: extract response id
    if (result === undefined) {
      // Something went wrong - reset
      resetState("Did not receive any response from server. Please try again.");
    } else {
      // TODO: set correct response id
      currentExecutionId = 1;
    }
  };

  var generateFile = function() {
    currentState = generatingFile;
    this.workingStatus("Creating Eclipse plugin file...");
    // TODO
    var fileLocation = serverAppModel.location + sbtEclipseProjectLocation;
    var fileContent = pluginFileContent;
    ajax.createContent(fileLocation, fileContent).done(function () {
      restartSbt();
    }).fail(function(err) {
      resetState("Could not create Eclipse plugin file. Please try again.");
    });
  };

  var restartSbt = function() {
    currentState = restartingSbt;
    // TODO : do we want to trigger an explicit restart or should the fact that a plugin file has been created trigger this automatically?
    // This has been implemented since the continuous restarting of sbt-server seemed to screw up the functionality of it
    var result = sbt.requestRestart();
  }

  var resetState = function(msg) {
    debug && console.log(msg);
    self.workingStatus(msg);
    currentState = idle;
    resetExecutionId();
  };

  var resetExecutionId = function() {
    currentExecutionId = -1;
  };

  return {
    generate: generate
  };

});
