if(process.argv.length < 5)
{
	console.log("Wrong parameter count!");
	console.log("Usage: node merge.js <base_file_name> <changes_file_name> <output_file_name>");
	return;
}

var base_file = process.argv[2];
var changes_file = process.argv[3];
var output_file = process.argv[4];

setTimeout( main, 0, base_file, changes_file, output_file);

function main(base_file, changes_file, output_file)
{
	var error_code = 1;
	try {
		//var TimeStart = new Date();
		var sdk_all = require('./sdk-all.js');
		var editor = new sdk_all.asc_docs_merge_api();

		var fs = require('fs');
		var base_doc = fs.readFileSync(base_file, 'utf-8');
		editor.LoadDocument( base_doc );

		var doc_changes = require(changes_file);
		editor.ApplyChanges( doc_changes );

		var changed_doc = editor.Save();
		fs.writeFileSync(output_file, changed_doc, 'utf-8');/**/

		//var TimeEnd = new Date();
		//console.log("Execution duration:", TimeEnd - TimeStart, " ms.");
		
		error_code = 0;
	}

	catch(err) {
		console.log("Error:", err);
	}

	finally	{
		process.exit(error_code);
	}
}
