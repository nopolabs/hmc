module.exports = function(eleventyConfig) {
  // Pass images through to _site without processing
  eleventyConfig.addPassthroughCopy("src/images");
  eleventyConfig.addPassthroughCopy("src/styles.css");
  eleventyConfig.addPassthroughCopy({ "mockups": "mockups" });
  eleventyConfig.addPassthroughCopy({ "favicon": "." });

  // JSON serialization filter for embedding data in templates
  eleventyConfig.addFilter("json", value => JSON.stringify(value));

  return {
    dir: {
      input: "src",
      output: "_site"
    }
  };
};
