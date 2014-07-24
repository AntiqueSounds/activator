/*
 Copyright (C) 2013 Typesafe, Inc <http://typesafe.com>
 */
define([
  'services/sbt',
  'services/fs'
], function(
  sbt,
  fs
) {

  // options is the observable where we put the results
  var combinedSearch = function(keywords, options) {
    debug && console.log("starting search on " + keywords);
    return $.when(fs.search(keywords), sbt.tasks.possibleAutocompletions(keywords))
      .then(function(searchValues, sbtCompletions) {
        console.log(searchValues, sbtCompletions)
        options( searchValues.concat(sbtCompletions) );
    });
  }

  return {
    combinedSearch: combinedSearch
  }
});
