define([
  'commons/websocket',
  'commons/types',
  './app'
], function(
  websocket,
  types,
  app
) {

  // -------------
  // Ajax Handlers
  function sbtRequest(what, o) {
    o.socketId = serverAppModel.socketId;
    var areq = {
      url: '/api/sbt/' + what,
      type: 'POST',
      dataType: 'json', // return type
      contentType: 'application/json; charset=utf-8',
      data: JSON.stringify(o)
    };
    return $.ajax(areq);
  }

  function possibleAutocompletions(partialCommand) {
    // TODO return something better (with the return value already parsed)
    return sbtRequest('possibleAutocompletions', {
      partialCommand: partialCommand
    }).pipe(function(completions) {
      return $.map(completions.choices, function(completion){
        return {
          title: completion.display,
          subtitle: "run sbt task " + completion.display,
          type: "Sbt",
          url: false,
          execute: partialCommand + completion.append
        }
      });
    });
  }

  function cancelExecution(id) {
    // TODO return something better (with the return value already parsed)
    return sbtRequest('cancelExecution', {
      executionId: id
    });
  }

  function requestExecution(command) {
    if (command == "run") {
      command = runCommand(); // typing 'run' execute runMain
    }
    // TODO return something better (with the return value already parsed)
    return sbtRequest('requestExecution', {
      command: command
    });
  }

  // -----------
  // Run command
  var runCommand = ko.computed(function() {
    if (app.currentMainClass()){
      return "runMain "+ app.currentMainClass();
    }
    else {
      return "run";
    }
  });

  // ------------------
  // Websocket Handlers
  var executionsById = {};
  var executions = ko.observableArray([]);
  var tasksById = {};

  function removeExecution(id, succeeded) {
    var execution = executionsById[id];
    if (execution) {
      // we want succeeded flag up-to-date when finished notifies
      execution.succeeded(true);
      execution.finished(new Date());
      delete executionsById[execution.executionId];
    }
  }

  var sbtEventStream = websocket.subscribe().equal('type','sbt');
  var subTypeEventStream = function(subType) {
    return sbtEventStream.fork().equal('subType',subType);
  }

  subTypeEventStream("TaskStarted").each(function(message) {
    var execution = executionsById[message.event.executionId]
    if (execution) {
      var task = {
        execution: execution,
        taskId: message.event.taskId,
        key: message.event.key ? message.event.key.key.name : null,
        finished: ko.observable(0), // 0 here stands for no Date() object
        succeeded: ko.observable(0) // 0 here stands for no Date() object
      }
      debug && console.log("Starting task ", task);
      // we want to be in the by-id hash before we notify
      // on the tasks array
      tasksById[task.taskId] = task;
      execution.tasks.push(task);
    } else {
      debug && console.log("Ignoring task for unknown execution " + message.event.executionId)
    }
  });


  subTypeEventStream("TaskFinished").each(function(message) {
    var task = tasksById[message.event.taskId];
    if (task) {
      task.execution.tasks.remove(function(item) {
        return item.taskId == task.taskId;
      });
      // we want succeeded flag up-to-date when finished notifies
      // task.succeeded(message.event.success);
      task.finished(true);
      delete tasksById[task.taskId];
    }
  });

  subTypeEventStream("ExecutionWaiting").each(function(message) {
    var execution = {
      executionId: message.event.id,
      command: message.event.command,
      started: ko.observable(new Date()),
      finished: ko.observable(0), // 0 here stands for no Date() object
      succeeded: ko.observable(0), // 0 here stands for no Date() object
      tasks: ko.observableArray([])
    }
    execution.finished.extend({ notify: 'always' });
    execution.running = ko.computed(function() {
      return !execution.finished();
    });
    execution.error = ko.computed(function() {
      return execution.finished() && !execution.succeeded();
    });
    execution.time = ko.computed(function() {
      if (execution.finished() && execution.started()){
        return "Completed in " + Math.round((execution.finished() - execution.started()) /1000) +" s";
      } else if (execution.started()) {
        return "Running for " + Math.round((new Date() - execution.started()) /1000) +" s";
      } else {
        return "Pending...";
      }
    });
    (function timer() { // Update counters in UI
      if (!execution.finished()){
        execution.finished(0); // 0 here stands for no Date() object
        setTimeout(timer, 100)
      }
    }());

    debug && console.log("Waiting execution ", execution);
    // we want to be in the by-id hash before we notify
    // on the executions array
    executionsById[execution.executionId] = execution;
    executions.push(execution);
  });

  subTypeEventStream("ExecutionStarting").each(function(message) {
    var execution = executionsById[message.event.executionId];
    if (execution) {
      execution.started(new Date());
    }
  });

  subTypeEventStream("ExecutionFailure").each(function(message) {
    removeExecution(message.event.id, false /* succeeded */);
  });

  subTypeEventStream("ExecutionSuccess").each(function(message) {
    removeExecution(message.event.id, true /* succeeded */);
  });

  // subTypeEventStream("CompilationFailure");

  // subTypeEventStream("TestEvent");

  // subTypeEventStream("BuildStructureChanged")

  var valueChanged = subTypeEventStream("ValueChanged").map(function(message) {
    return {
      key: message.event.key.key.name,
      value: message.event.value.value
    }
  });

  // discoveredMainClasses
  valueChanged.equal('key', 'discoveredMainClasses').each(function(message) {
    app.mainClasses(message.value); // All main classes
    if (!app.currentMainClass() && message.value[0]){
      app.currentMainClass(message.value[0]); // Selected main class, if empty
    }
  });

  return {
    sbtRequest: sbtRequest,
    possibleAutocompletions: possibleAutocompletions,
    requestExecution: requestExecution,
    cancelExecution: cancelExecution,
    executions: executions,
    active: {
      turnedOn:     "",
      compiling:    "",
      running:      "",
      testing:      ""
    },
    actions: {
      turnOnOff:    function() {},
      compile:      function() {
        requestExecution("compile");
      },
      run:          function() {
        requestExecution('run');
      },
      test:         function() {
        requestExecution("test");
      }
    }
  }

});
