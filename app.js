var spawn = require('child_process').spawn
  , util = require('util')
  , path = require('path')
  , exec = require('child_process').exec
  , resolve = require('path').resolve
  , fs = require('fs')
  , cs = require('coffee-script')
  , config = require('./config.json');


var app = angular.module('seleniumUiApp', ['ngSanitize', 'ui.codemirror']);
var cwd = resolve(process.cwd() + '/../selenium');

app.controller('seleniumUiController', ['$scope', '$timeout', '$sanitize', function($scope, $timeout, $sanitize){

  // config options for the CodeMirror editor
  $scope.editorOptions = {
    mode: 'coffeescript',
    lineNumbers: true,
    theme: 'twilight',
    gutters: ['linenumbers', 'errors'],
    tabSize: 2,
    lineWrapping: true,
    viewportMargin: Infinity
  };

  // get app configuration from file
  var cnf = processConfig(config);
  
  // setup initial scope vars
  $scope.init = function() {
    if ($scope.currentTestFile && $scope.currentTestFile.changed) {
      if (!confirm('Discard changes to current file?')) {
        return;
      }
    }

    // array of available environments (subdomains)
    $scope.environments = cnf.environments;
    // set the default environment to use
    $scope.environment = cnf.environments[0];
    // list of domains (mints)
    $scope.domains = cnf.domains;
    // set default mint
    $scope.mint = cnf.domains[0];
    // list of selenium servers
    $scope.seleniums = cnf.seleniums;
    // set default selenium server
    $scope.selenium = cnf.seleniums[0];
    // list of available browsers
    $scope.browsers = cnf.browsers;
    // default browser
    $scope.browser = cnf.browsers[0];
    // initialize directory stack
    $scope.dir = [];
    // get the subdirectories of the current directory
    $scope.subdirs = getSubdirs(cwd);
    // get the test files in the current directory
    $scope.testFiles = getTestFiles(cwd);
    // no initial test file
    $scope.currentTestFile = null;
    // list of extra options for tests/describes
    $scope.extras = ['none', 'skip', 'only'];
  }
  $scope.init();

  // update the file/directory listing
  $scope.refreshSubdirs = function(){
    $scope.subdirs = getSubdirs(cwd + path.sep + $scope.dir.join(path.sep));
    $scope.testFiles = getTestFiles(cwd + path.sep + $scope.dir.join(path.sep));
  }

  // move to a selected directory in the stack by offset number from the base directory
  // - makes navigating backwards thru breadcrumbs easier
  $scope.dirByPart = function(index) {
    if ($scope.currentTestFile && $scope.currentTestFile.changed) {
      if (!confirm('Discard changes to current file?')) {
        return;
      }
    }

    $scope.currentTestFile = null;
    $scope.dir = $scope.dir.slice(0, index + 1);
    $scope.refreshSubdirs();
  }

  // move into a subdirectory by name
  // - pushes the new subdirectory onto the stack
  $scope.pushDir = function(part) {
    if ($scope.currentTestFile && $scope.currentTestFile.changed) {
      if (!confirm('Discard changes to current file?')) {
        return;
      }
    }

    $scope.currentTestFile = null;
    $scope.dir.push(part);
    $scope.refreshSubdirs();
  }

  // load a test file in the current directory by name
  $scope.showTestFile = function(file) {
    if ($scope.currentTestFile && $scope.currentTestFile.changed) {
      if (!confirm('Discard changes to current file?')) {
        return;
      }
    }

    // init the file scope object
    $scope.currentTestFile = {
      name: file,
      changed: false,
      hasErrors: false
    };

    // read in the raw file content
    $scope.currentTestFile.content = fs.readFileSync(cwd + path.sep + path.join($scope.dir.join(path.sep), file), {encoding: 'utf8'});
    
    // parse the content for display
    var parsed = parseTestFile(fs.readFileSync(cwd + path.sep + path.join($scope.dir.join(path.sep), file), {encoding: 'utf8'}));
    
    $scope.currentTestFile.helpers = parsed.helpers;
    $scope.currentTestFile.sections = parsed.sections;
    $scope.currentTestFile.sections.isBase = true;
  }

  $scope.markChanged = function() {
    $scope.currentTestFile.changed = true;
  }

  // save the current file (if it has changed and has no compile errors)
  $scope.saveFile = function() {
    if ($scope.currentTestFile.hasErrors) {
      alert('Correct errors before saving!');
      return false;
    }
    // compile the node tree into coffeescript
    var newTestContent = createTestFileContent($scope.currentTestFile.sections, $scope.currentTestFile.helpers);
    // assemble the file location/name
    var filePath = path.join(cwd + path.sep + path.join($scope.dir.join(path.sep), $scope.currentTestFile.name));
    // write the compiled coffeescript to the file
    fs.writeFileSync(filePath, newTestContent);
    // mark the current file as unchanged (to avoid a confirmation popup)
    $scope.currentTestFile.changed = false;
    // reload the file
    $scope.showTestFile($scope.currentTestFile.name);
    $scope.currentTestFile.justSaved = true;
    $timeout(function(){
      $scope.currentTestFile.justSaved = false;
    }, 2000);
    return true;
  }

  // verify there are no errors in a node
  // - checks subnodes recursively
  $scope.testScript = function(node) {
    // innocent until proven guilty
    node.compileError = null;
    // mark file as changed
    $scope.currentTestFile.changed = true;
    
    // try to compile as coffeescript
    // consider script OK if there are no compile errors
    // (obviously this does nothing for runtime or logic errors)
    try {
      // clear any previous error markers
      node.editor.clearGutter('errors');
      // compile
      cs.compile(node.code || node.other || "");
      // set the file as error free if there are no other error flags
      validateFile()
    } catch (e) {
      // save the error to the node's scope
      node.compileError = e;
      // mark the file as having errors
      $scope.currentTestFile.hasErrors = true;

      // if we have line_number information then attempt to show a marker
      if (!e.location || !e.location.first_line) return;
      for (var i=e.location.first_line; i<=e.location.last_line; i++) {
        var errorMarker = document.createElement('div')
          , errorText   = document.createTextNode('>');
        errorMarker.appendChild(errorText);
        errorMarker.setAttribute('style', 'color: red; font-weight: bold;');
        node.editor.setGutterMarker(i, 'errors', errorMarker);
      }
    }
  }

  // helper function to grab ref to each CodeMirror instance and bind it to the node that owns it
  $scope.editorLoaded = function(node) {
    return function(_editor) {
      node.editor = _editor;
    }
  }

  // add a test helper to the current file
  $scope.addHelper = function() {
    var helper = prompt("Add Helper");
    if (helper !== null && helper !== "") {
      $scope.currentTestFile.helpers.push(helper);
      $scope.currentTestFile.changed = true;
    }
  }

  // remove a helper from the current file by index number in the helpers array
  $scope.removeHelper = function(index) {
    if (!$scope.currentTestFile.helpers[index]) return;
    $scope.currentTestFile.helpers.splice(index, 1);
    $scope.currentTestFile.changed = true;
  }

  $scope.addGlobals = function(node) {
    node.other = '';
  }

  $scope.addDescribe = function(node) {
    var name = prompt('Enter the name for the new Describe section');

    if (!name) {
      return;
    }

    var newDescribe = {
      name: name,
      describes: [],
      tests: [],
      other: null,
      extra: 'none'
    };

    node.describes.push(newDescribe);
  }

  $scope.deleteDescribe = function(node, index) {
    if (!confirm('Are you sure you want to delete this section?')) {
      return;
    }
    node.splice(index, 1);
    $scope.currentTestFile.changed = true;
  }

  $scope.addTest = function(node) {
    var name = prompt('Enter the name for the new Test');

    if (!name) {
      return;
    }

    var newTest = {
      name: name,
      code: '',
      extra: 'none'
    };

    node.tests.push(newTest);
  }

  $scope.deleteTest = function(node, index) {
    if (!confirm('Are you sure you want to delete this test?')) {
      return;
    }
    node.splice(index, 1);
    $scope.currentTestFile.changed = true;
  }

  $scope.runDirectory = function() {
    if ($scope.testRunning) {
      alert('A test is already running!');
      return;
    }

    if ($scope.currentTestFile && $scope.currentTestFile.changed) {
      var save = confirm('Save changes to current file and run all tests?');
      if (!save) return;
      var saved = $scope.saveFile();
      if (!saved) return;
    }

    $scope.currentTestFile = null;

    // assemble the file location/name
    var dirPath = path.join(cwd, $scope.dir.join(path.sep));
    // get a ref to the swd (test runner) executable
    var swd = path.join(cwd, 'node_modules/.bin/swd');
    // spawn the test runner in a new process
    var test = spawn(swd, ['-l', getTestUrl(), 
                           '-s', getSeleniumUrl(), 
                           '-f', dirPath, 
                           '-r', '/usr/lib/node_modules/selenium-ui-mocha-reporter/selenium-ui-mocha-reporter.js', 
                           '-b', $scope.browser.string,
                           '-p', 5,
                           '-x'],
                           {cwd: cwd});
    
    // flag as test running
    $scope.testRunning = true;

    // bind output events from test process
    test.stdout.on('data', function(data){
      data.toString().split('\n').forEach(show);
    });
    //test.stderr.on('data', show);
    test.on('close', function(){
      $scope.$apply(function(){
        $scope.testRunning = false;
      });
    });

    // do stuff with the test process output
    $scope.runningTests = [];
    var testMap = {};
    function show(data){
      console.log(data + '');
      var obj;
      data = data + '';
      try {
        obj = JSON.parse(data);
      } catch(e) {
        return;
      }
      $scope.$apply(function(){
        if (obj[1] && obj[1].fullTitle) {
          if (obj[0] === 'test') {
            testMap[obj[1].fullTitle] = $scope.runningTests.length;
            $scope.runningTests.push({id: $scope.runningTests.length, title: obj[1].title, fullTitle: obj[1].fullTitle, status: "running"});
          }
          if (obj[0] === 'pass' && typeof testMap[obj[1].fullTitle] !== 'undefined') {
            $scope.runningTests[testMap[obj[1].fullTitle]].status = "passed";
          }
          if (obj[0] === 'fail' && typeof testMap[obj[1].fullTitle] !== 'undefined') {
            $scope.runningTests[testMap[obj[1].fullTitle]].status = "failed";
            $scope.runningTests[testMap[obj[1].fullTitle]].error = obj[2];
          } 
        }
      });
    }
  }

  // run a test given a node
  // - rucursively runs all tests in the node's hierarchy
  $scope.runTest = function(section) {
    if ($scope.testRunning) {
      alert('A test is already running!');
      return;
    }

    if (!validateSection(section)) {
      alert('Correct errors before running this test');
      return;
    }

    // get the other (globals) from each section passed in
    var args = Array.prototype.slice.call(arguments, 1);
    var others = [];
    args.forEach(function(section){
      if (section.other) others.unshift(section.other);
    });
    if ($scope.currentTestFile.sections.other && $scope.currentTestFile.sections.other !== section.other) {
      others.unshift($scope.currentTestFile.sections.other);
    }

    //add a blank line
    others.push('');

    // stringify the arra
    others = others.join('\n');

    // verify that the globals we're adding will compile
    try {
      cs.compile(others);
    } catch(e) {
      alert("Errors in parent globals.  Please correct errors before running this test");
      return;
    }

    // compile the node tree into coffeescript
    var newTestContent = createTestFileContent(section, $scope.currentTestFile.helpers, null, others);
    // assemble the tmp file location/name
    var tmpFile = path.join(cwd, 'tmp.coffee');
    // write the compiled coffeescript to the tmp file
    fs.writeFileSync(tmpFile, newTestContent);
    
    // get a ref to the swd (test runner) executable
    var swd = path.join(cwd, 'node_modules/.bin/swd');
    // spawn the test runner in a new process
    var test = spawn(swd, ['-l', getTestUrl(), '-s', getSeleniumUrl(), '-f', tmpFile, '-r', '/usr/lib/node_modules/selenium-ui-mocha-reporter/selenium-ui-mocha-reporter.js', '-b', $scope.browser.string], {cwd: cwd});
    
    // flag as test running
    $scope.testRunning = true;

    // bind output events from test process
    test.stdout.on('data', show);
    test.stderr.on('data', show);
    // delete the tmp file when the process ends    
    test.on('close', function(){
      fs.unlinkSync(tmpFile);
      $scope.$apply(function(){
        $scope.testRunning = false;
      });
    });

    // do stuff with the test process output
    var output = '';
    function show(data){
      $scope.$apply(function(){
        output += data;
        console.log(data + '');
      });
    }
  }

  // return formatted URL for tests to run against based on selected options
  function getTestUrl() {
    return $scope.environment.protocol + $scope.environment.subdomain + '.' + $scope.mint + ($scope.environment.port?':'+$scope.environment.port:'') + $scope.environment.entry;
  }

  // return the URL of the selenium server to use for tests
  function getSeleniumUrl() {
    return $scope.selenium.url;
  }

  // scan all nodes in the current file and return true if there are no error flags, or false otherwise
  function validateFile() {
    //start the recursive function on the file's base node
    $scope.currentTestFile.hasErrors = !validateSection($scope.currentTestFile.sections);
  }

  // recursive fuction to check current node and all sub-nodes for error flags
  function validateSection(node) {
    // if the base node has an error return false immediately
    if (node.compileError) return false;
    if (node.tests) {
      // loop thru all tests on the current node and return false if any have errors
      var testsOk = node.tests.every(function(test){
        return test.compileError == null
      });
      if (!testsOk) return false;
    }
    if (node.describes) {
      // resursively check all describes and return false if any have errors
      var subSectionsOk = node.describes.every(validateSection);
      if (!subSectionsOk) return false;
    }
    return true;
  }
}]);

// process config file content
function processConfig(config) {
  var result = {
        environments: [],
        domains: [],
        seleniums: [],
        browsers: []
      }
    , subject, i
    , itemProps
    , item
    , defaults;

  var subjects = ['environments', 'domains', 'seleniums', 'browsers'];

  for (i in subjects) {
    subject = subjects[i];
    defaults = {};
    if (config[subject].length !== undefined) {
      for (item in config[subject]) {
        result[subject].push(config[subject][item]);
      }
    } else {
      for (item in config[subject]) {
        if (item === 'default') {
          defaults = config[subject].default;
          continue;
        }
        itemProps = config[subject][item];
        itemProps.name = item;
        result[subject].push(angular.extend({}, defaults, itemProps));
      }
    }
  }

  return result;
}

// parse raw coffeescript into node tree
function parseTestFile(content) {
  var tokens = cs.tokens(content) // use coffeescript lexer to get tokens from the code
    , helpers = []
    , globals = []
    , sections = []
    , consumed = {line: 0, col: 0};

  // parse the header
  helpers = checkHeader(tokens, consumed);
  // if the header wasn't formatted properly...
  if (helpers === false) {
    alert('Not a test file!');
    return {sections: {other: content}};
  }

  // strip the first line (header) and replace all tabs with 2 spaces
  content = content.replace(/^.*\n/, '').replace(/\t/g, "  ");

  // get the sections
  sections = getTestFileSection(content, tokens, consumed, 'BASE');

  // check for parse errors
  if (sections instanceof Error) {
    alert(sections.message);
  }

  return {helpers: helpers, sections: sections};

}

// verifies simpke-mocha-wd-sync is included and returns an array of any helpers that were requested
// also updates the consumed object with the new line and column where the parsing head is
function checkHeader(tokens, consumed) {
  var helpers = [];
  
  // array of tokens that are ALWAYS expected at the beginning of a valid test file
  var header = [
    ['IDENTIFIER', 'require'],
    ['CALL_START', '('],
    ['STRING', 'simple-mocha-wd-sync'],
    ['CALL_END', ')'],
    ['CALL_START', '(']
  ];

  // innocent until proven guilty 
  var ok = true;

  // loop over actual tokens and expected tokens and verify they match
  for (var i=0, len=header.length; i<len; i++) {
    var token = tokens.shift();
    if (token[0] === 'STRING') {
      var quote = token[1][0];
      token[1] = unquote(token);
    }
    if (token[0] !== header[i][0] || token[1] !== header[i][1]) {
      tokens.unshift([token, header[i]]);
      return false;
      ok = false;
    }
  }

  // if the header didn't match up so far, return false
  if (!ok) {
    return false;
  }

  // verify that the remainder of the header is correct
  // - no helpers
  // - one helper (string)
  // - multiple helpers (array of strings)
  token = tokens.shift();
  if (token[0] === '[') {
    while ((token = tokens.shift())[0] === 'STRING') {
      helpers.push(unquote(token));
      if (tokens[0][0] === ',') {
        tokens.shift();
      }
    }
    if (token[0] !== ']') {
      return false;
    }
    token = tokens.shift();
  } else if (token[0] === 'STRING') {
    helpers.push(unquote(token));
    token = tokens.shift();
  }

  if (token[0] !== 'CALL_END') {
    return false;
  }

  token = tokens.shift();
  if (token[0] !== 'TERMINATOR') {
    return false;
  }

  // mark the amount of the raw code that was used by the header
  consumed.line = token[2].last_line;
  consumed.col = token[2].last_column;

  return helpers;
}

// parse a section of code from a test file and return {name: String, describes: Array, tests: Array, other: String}
// - recursively parses "describe" sections
function getTestFileSection(src, tokens, consumed, name, baseIndent, srcOffset) {
  var l = src.split('\n');

  var section
    , sectionType
    , sectionName
    , indent = 0
    , token
    , tokenBuffer
    , describes = []
    , tests = []
    , other = ""
    , extra
    , newBaseIndent
    , thisSection
    , start = {line: consumed.line, col: 0}
    , end = {line: consumed.line, col: 0};

  name = name || '';
  baseIndent = baseIndent || 0;
  srcOffset = srcOffset || 0;

  // prime the first token
  token = tokens.shift();

  // loop through the code/tokens
  do {
    if (token[1] === 'describe' || token[1] === 'it') {
      sectionType = token[1];

      // tokens refrence locations in the original source code
      // so if we are in a recursive call then shift the location
      // to compensate
      start.line = token[2].first_line - srcOffset - 1
      
      extra = getExtra();
      sectionName = parseRemainingSectionHeader();

      indent = baseIndent + ~~token[1];
      newBaseIndent = indent;

      tokenBuffer = processBlock();
      
      if (sectionType === 'describe') {
        // recursively parse the current describe using the token buffer and the subsection of the raw code that we determined falls inside the descibe
        thisSection = getTestFileSection(
          src.split('\n')
             .slice(start.line + 1, end.line + 1)
             .join('\n'), 
          tokenBuffer, 
          {line: 0, col: 0}, 
          sectionName, 
          newBaseIndent, 
          start.line + srcOffset + 1
        );
        
        // store the extra info parsed above onto the node
        thisSection.extra = extra;

        // add the parsed describe to the current node
        describes.push(thisSection);
      } else if (sectionType === 'it') {
        // add the parsed test to the current node
        tests.push({
          name: sectionName, 
          extra: extra, 
          code: src.split('\n')
                   .slice(start.line + 1, end.line + 1)
                   .join('\n')
                   .replace(new RegExp('^' + Array(newBaseIndent + 1).join(' '), 'gm'), '')
        });
      }
    } else {
      // anything that isn't an 'it' or 'describe' section is either file globals, or section globals
      // and are stored in the 'other' property of the node it was found in
      start.line = token[2].first_line - srcOffset - 1
      while (tokens.length && tokens[0][1] !== 'describe' && tokens[0][1] !== 'it') {
        token = tokens.shift();
      }
      end.line = token[2].first_line - srcOffset - 1;
      other += src.split('\n').slice(start.line, end.line + 1).join('\n').replace(new RegExp('^' + Array(baseIndent + 1).join(' '), 'gm'), '') + '\n';
      token = tokens.shift();
    }
  } while (tokens.length && (token[1] === 'describe' || token[1] === 'it')); // loop until there's nothing valid left to parse

  // strip white space from front and back of globals
  other = other.replace(/(^\s*)|(\s*$)/g, '');
  if (other === "") {
    other = null;
  }

  return {name: name, describes: describes, tests: tests, other: other};

  
  // helper to parse the 'extra' piece of a section header and return the extra flag or 'none'
  function getExtra() {
    var extra = 'none';

    // get next token
    token = tokens.shift();

    // grab extra flags (skip or only) if set
    if (token[0] === '.') {
      token = tokens.shift();
      if (token[1] === 'skip') {
        extra = 'skip';
      } else if (token[1] === 'only') {
        extra = 'only';
      } else {
        return new Error('Invalid extra flag: .' + token[1]);
      }
      token = tokens.shift();
    }

    return extra;
  }

  // helper to parse the remaining part of a section header after getting the extra flag
  // returns the section's name
  function parseRemainingSectionHeader() {
    var sectionName;

    // verify the "describe" call is formatted properly
    if (token[0] !== 'CALL_START') return new Error('Invalid statement parameter: ' + token[1]);
    token = tokens.shift();
    if (token[0] !== 'STRING') return new Error('Invalid statement parameter: ' + token[1]);
    // grab the name of this describe section
    sectionName = unquote(token);
    token = tokens.shift();
    if (token[0] !== ',') return new Error('Invalid statement parameter: ' + token[1]);
    token = tokens.shift();
    if (token[0] !== '->') return new Error('Invalid statement parameter: ' + token[1]);
    token = tokens.shift();
    
    // grab the indent amount
    if (token[0] !== 'INDENT') return new Error('Invalid statement parameter: ' + token[1]);

    return sectionName;
  }

  // loop thru tokens until we exit the current block (indentation level)
  function processBlock() {
    var buffer = []
      , indentCount = 1;

    // loop through and buffer tokens until we outdent back to where we started
    // theoretically this should grab everything 
    while (tokens.length && indentCount) {
      token = tokens.shift();
      if (token[0] === 'OUTDENT') {
        indent = ~~token[1];
        indentCount--;
        if (indentCount > 0) {
          buffer.push(token);
        }
      } else {
        buffer.push(token);
        if (token[0] === 'INDENT') {
          indent += ~~token[1];
          indentCount++
        }
      }
    }
      
    // mark new end line location
    end.line = token[2].first_line - srcOffset - 1;

    // consume 2 tokens (CALL_END + OUTDENT) to get us ready for the next section
    tokens.shift();
    tokens.shift();
    // prime the next token (shoudl be a 'describe', 'it', or the end of the file)
    token = tokens.shift();

    return buffer;
  }

}

// recursively generate runnable coffeescript from a given node
function createTestFileContent(node, helpers, indent, extraGlobals) {
  var firstCall = false
    , out = []
    , i;
  
  if (!helpers || !helpers.length) {
    helpers = helpers || [];
  }
  
  // if no indent provided, assume this is the beginning of the file
  // add the header with any requested helpers
  if (!indent) {
    indent = indent || '';
    out.push("require('simple-mocha-wd-sync')(" + JSON.stringify(helpers) + ")");
    out.push('');
    firstCall = true;
  }

  if (extraGlobals) {
    out.push(extraGlobals);
  }

  // add any globals for the current section
  if (node.other) {
    out.push(indentify(node.other, (firstCall?'':'  ')));
    out.push('');
  }


  if (firstCall && !node.isBase && !node.code) {
    out.push(indent + "describe" + ((node.extra && node.extra !== 'none')?"."+node.extra:"") + " '" + node.name.replace(/'/g, "\\'") + "', ->");
    out.push('');
    indent += '  ';
  }

  // loop over describe sections and recursively genreate their code
  if (node.describes && node.describes.length) {
    for (i in node.describes) {
      describe = node.describes[i];
      // create the header for the describe
      out.push(indent + "describe" + ((describe.extra && describe.extra !== 'none')?"."+describe.extra:"") + " '" + describe.name.replace(/'/g, "\\'") + "', ->");
      out.push('');
      // recursive call to handle the describe
      out.push(indentify(createTestFileContent(describe, null, indent + "  ")));
    }
  }

  // loop over tests and add their content to the file
  if (node.tests && node.tests.length) {
    for (i in node.tests) {
      test = node.tests[i];
      out.push("  it" + ((test.extra && test.extra !== 'none')?"."+test.extra:"") + " '" + test.name.replace(/'/g, "\\'") + "', ->");
      out.push(indentify(test.code, "    "));
      out.push('');
    }
  }

  // if the passed in node is a test
  if (node.code) {
    out.push(indent + "describe 'Inline Test', ->");
    out.push('');
    out.push("  it" + ((node.extra && node.extra !== 'none')?"."+node.extra:"") + " '" + node.name.replace(/'/g, "\\'") + "', ->");
    out.push(indentify(node.code, "    "));
    out.push('');
  }

  // convert the output array to a string
  return out.join('\n');

  // helper function to handle indenting
  function indentify(text, ind) {
    ind = ind || indent;
    return ind + text.split('\n').join('\n' + ind);
  }

}

// get an array of subdirectories in the current directory
function getSubdirs(dir) {
  var i
    , files
    , file
    , subdirs = []
      // array of directories to hide
    , hide = ['node_modules', 'simple-mocha-wd-sync', 'helpers'];

  try {
    files = fs.readdirSync(dir);
  } catch (e) {
    return [];
  }

  for (i in files) {
    file = fs.statSync(path.join(dir, files[i]));
    // ignore hidden directories
    if (file.isDirectory() && hide.indexOf(files[i]) === -1) {
      subdirs.push(files[i]);
    }
  }

  return subdirs;
}

// get an array of test files in the current directory
function getTestFiles(dir) {
  var i
    , files
    , file
    , tests = [];

  try {
    files = fs.readdirSync(dir);
  } catch (e) {
    return [];
  }

  for (i in files) {
    file = fs.statSync(path.join(dir, files[i]));
    
    // only return .coffee files
    if (file.isFile() && files[i].split('.').pop() === 'coffee') {
      tests.push(files[i]);
    }
  }

  return tests;
}

// remove quotes from a coffeescript STRING token
function unquote(token) {
  return token[1].replace(new RegExp('^' + token[1][0]), '').replace(new RegExp(token[1][0] + '$'), '');
}