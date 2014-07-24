import sbt._
import ActivatorBuild._
import Keys._


object LocalTemplateRepo {
  // TODO - We can probably move this to its own project, to more clearly delineate that the UI uses these
  // for local testing....
  val localTemplateCache = settingKey[File]("target directory for local template cache")
  val localTemplateCacheCreated = taskKey[File]("task which creates local template cache")
  val remoteTemplateCacheUri = settingKey[String]("base URI to get template cache from")
  val localTemplateCacheHash = settingKey[String]("which index from the remote URI to seed the cache from")
  val latestTemplateCacheHash = taskKey[String]("get the latest template cache hash from the remote URI")
  val checkTemplateCacheHash = taskKey[String]("throw if our configured template cache hash is not the latest, otherwise return the local (and latest) hash")
  val enableCheckTemplateCacheHash = settingKey[Boolean]("true to enable checking we have latest cache before we publish")

  def settings: Seq[Setting[_]] = Seq(
    localTemplateCache <<= target(_ / "template-cache"),
    localTemplateCacheCreated <<= (localTemplateCache, localTemplateCacheHash, Keys.fullClasspath in Runtime, remoteTemplateCacheUri) map makeTemplateCache,
    scalaVersion := Dependencies.scalaVersion,
    libraryDependencies += Dependencies.templateCache,
    // TODO - Allow debug version for testing?
    remoteTemplateCacheUri := "http://downloads.typesafe.com/typesafe-activator",
    localTemplateCacheHash := "06a31bb927e0a5e8fbf9f5f08dce4abc2f5f23b2",
    latestTemplateCacheHash := downloadLatestTemplateCacheHash(remoteTemplateCacheUri.value),
    checkTemplateCacheHash := {
      if (enableCheckTemplateCacheHash.value)
        checkLatestTemplateCacheHash(localTemplateCacheHash.value,
                                     latestTemplateCacheHash.value)
      else
        localTemplateCacheHash.value
    },
    enableCheckTemplateCacheHash := true
  )
  
  def invokeTemplateCacheRepoMakerMain(cl: ClassLoader, dir: File, uri: String): Unit =
    invokeMainFor(cl, "activator.templates.TemplateCacheSeedGenerator", Array("-remote", uri, dir.getAbsolutePath))
  
  private def makeClassLoaderFor(classpath: Keys.Classpath): java.net.URLClassLoader = {
    val jars = classpath map (_.data.toURL)
    new java.net.URLClassLoader(jars.toArray, null)
  }
  
  private def invokeMainFor(cl: ClassLoader, mainClass: String, args: Array[String]): Unit = {
    println("Loading " + mainClass + " from: " + cl)
    val maker = cl.loadClass(mainClass)
    println("Invoking object: " + maker)
    val mainMethod = maker.getMethod("main", classOf[Array[String]])
    println("Invoking maker: " + maker)
    mainMethod.invoke(null, args)
  }

  def makeTemplateCache(targetDir: File, hash: String, classpath: Keys.Classpath, uri: String): File = {
    // TODO - We should check for staleness here...
    if(!targetDir.exists) try {
      IO createDirectory targetDir

      IO.write(targetDir / "cache.properties", "cache.hash=" + hash + "\n")

      val cl = makeClassLoaderFor(classpath)
      // Akka requires this crazy
      val old = Thread.currentThread.getContextClassLoader
      Thread.currentThread.setContextClassLoader(cl)
      try invokeTemplateCacheRepoMakerMain(cl, targetDir, uri)
      finally Thread.currentThread.setContextClassLoader(old)
    } catch {
      case ex: Exception =>
         IO delete targetDir
         throw ex
    }
    targetDir
  }

  def downloadLatestTemplateCacheHash(uriString: String): String = {
    IO.withTemporaryDirectory { tmpDir =>
      // this is cut-and-pastey/hardcoded vs. activator-template-cache,
      // but it's not worth the headache of depending on activator-template-cache.
      // If this ever breaks it should be obvious and easy to fix.
      val propsFile = tmpDir / "current.properties"
      IO.download(new URL(uriString + "/index/v2/current.properties"), propsFile)
      val fis = new java.io.FileInputStream(propsFile.getAbsolutePath)
      try {
        val props = new java.util.Properties
        props.load(fis)
        Option(props.getProperty("cache.hash")).getOrElse(sys.error("No cache.hash in current.properties"))
      } finally {
        fis.close()
      }
    }
  }

  def checkLatestTemplateCacheHash(ourHash: String, latestHash: String): String = {
    if (ourHash != latestHash)
      sys.error(s"The latest template index is ${latestHash} but our configured index is ${ourHash} (if you want to override this, `set LocalTemplateRepo.enableCheckTemplateCacheHash := false` perhaps)")
    else
      ourHash
  }
}
