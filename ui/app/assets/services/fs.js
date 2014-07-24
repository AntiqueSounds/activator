define(function() {

  var search = function(keywords){
    var url = '/app/' + window.serverAppModel.id + '/search/' + keywords;
    return $.ajax({
     url: url,
     dataType: 'json'
    }).pipe(function(data) {
      return data || [];
    });
  }


  return {
    search: search
  }

})
